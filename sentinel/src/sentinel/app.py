"""Point d'entrée : `python -m sentinel --config config/config.yaml [options]`.

Séquence de démarrage :
  1. config + secrets (.env) ; logs avec masquage des secrets ;
  2. contrôle de l'horloge locale vs serveur Binance (un décalage fausse les latences) ;
  3. chauffe des indicateurs avec l'historique (cache Parquet + REST pour le manquant) ;
  4. ouverture et chauffe de la connexion Telegram ;
  5. lancement des flux WebSocket, du pipeline et du watchdog.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import signal
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np

from sentinel.alerts.commands import CommandBot, CommandContext, Commands
from sentinel.alerts.console import ConsoleNotifier
from sentinel.alerts.events import load_events
from sentinel.alerts.format import format_alert
from sentinel.alerts.reporter import ReportWorker, RichNotifier
from sentinel.alerts.telegram import TelegramClient
from sentinel.core.config import AppConfig, Secrets, load_config
from sentinel.core.logging import configure_logging, get_logger
from sentinel.core.models import StreamKey
from sentinel.data.feeds.binance import BinanceKlineFeed
from sentinel.data.history import BinanceHistory, ParquetCache, load_warmup
from sentinel.data.watchdog import FeedWatchdog
from sentinel.indicators.engine import IndicatorEngine
from sentinel.journal.db import Journal, JournalWriter
from sentinel.paper.reporting import weekly_text
from sentinel.paper.service import PaperService, now_ms
from sentinel.paper.tracker import PaperTracker
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import (
    Detector,
    Gate,
    Pipeline,
    ProbeDetector,
    stream_name,
    warm_up,
)
from sentinel.pipeline.strategy_detector import StrategyDetector, load_reference_r, load_stats
from sentinel.strategies.registry import strategy_factory

log = get_logger("sentinel")


class FatalRestart(Exception):
    """Arrêt volontaire pour être relancé par Docker (restart: unless-stopped)."""


def seconds_until_weekly(now: datetime, weekday: int | None, hour_utc: int) -> float:
    """Secondes jusqu'au prochain (jour de semaine, heure UTC) strictement futur.
    weekday=None : tous les jours."""
    target = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    days = 0 if weekday is None else (weekday - now.weekday()) % 7
    target += timedelta(days=days)
    if target <= now:
        target += timedelta(days=1 if weekday is None else 7)
    return (target - now).total_seconds()


async def check_clock(history: BinanceHistory) -> float:
    skew, unc = await history.estimate_clock_skew()
    level = "warning" if abs(skew) - unc > 250 else "info"
    getattr(log, level)("clock_skew", skew_ms=round(skew, 1), uncertainty_ms=round(unc, 1))
    return skew


async def run(
    cfg: AppConfig, secrets: Secrets, *, dry_run: bool, probe: bool, duration_s: float | None
) -> dict[str, float]:
    keys = [
        StreamKey(m, s, tf) for m in cfg.markets for s in cfg.watchlist for tf in cfg.timeframes
    ]
    recorder = LatencyRecorder(cfg.latency.target_ms)

    notifier: RichNotifier
    telegram: TelegramClient | None = None
    if dry_run or not (secrets.telegram_bot_token and secrets.telegram_chat_id):
        if not dry_run:
            log.warning("telegram_not_configured_fallback_console")
        notifier = ConsoleNotifier()
    else:
        telegram = TelegramClient(secrets.telegram_bot_token, secrets.telegram_chat_id)
        me = await telegram.warmup()
        log.info("telegram_ready", bot=me.get("username"))
        notifier = telegram

    async with httpx.AsyncClient(timeout=20.0) as http:
        history = BinanceHistory(cfg.binance, http)
        cache = ParquetCache(cfg.history.cache_dir)
        with contextlib.suppress(httpx.HTTPError):
            await check_clock(history)

        engines = {key: IndicatorEngine(key, cfg.indicators) for key in keys}
        bars_by_key = {
            key: await load_warmup(key, cfg.history.warmup_bars, history, cache) for key in keys
        }

        # --- journal et paper trading (rechargés AVANT la chauffe : la chauffe rejoue les
        # bougies manquées pendant un arrêt sur les trades papier ouverts) ----------------
        journal = await Journal(cfg.paper.journal_path).open()
        writer = JournalWriter(journal)
        enabled = {n: e for n, e in cfg.strategies.items() if e.enabled}
        ref_r: dict[str, list[float]] = {}
        for name in enabled:
            ref_r.update(load_reference_r(cfg.alerts.stats_dir, name))
        ref_means = {k: float(np.mean(v)) for k, v in ref_r.items() if v}
        tracker = PaperTracker(
            cfg.risk,
            ref_oos_r=ref_r,
            divergence_min_trades=cfg.paper.divergence_min_trades,
            divergence_alpha=cfg.paper.divergence_p_value,
        )
        tracker.load(
            await journal.paper(("pending", "open", "closed", "cancelled")),
            next_alert_id=await journal.max_id("alerts") + 1,
            peak_equity=await journal.get_state("peak_equity"),
            breaker=bool(await journal.get_state("breaker", False)),
        )
        gate = Gate(observation=lambda: tracker.breaker_tripped)
        gate.paused = bool(await journal.get_state("paused", False))
        service = PaperService(tracker, writer, notifier)

        score_file = cfg.alerts.stats_dir / "score.json"
        score_validated = bool(
            score_file.exists() and json.loads(score_file.read_text()).get("validated")
        )
        detectors: list[Detector] = [ProbeDetector()] if probe else []
        strat_dets: list[StrategyDetector] = []
        for name, entry in enabled.items():
            det = StrategyDetector(
                strategy_factory(name, entry),
                entry.markets,
                engines,
                cfg.risk,
                load_stats(cfg.alerts.stats_dir, name),
                format_alert,
                open_risk_pct=tracker.open_risk_pct,
                score_validated=score_validated,
            )
            strat_dets.append(det)
            detectors.append(det)
        warm_up(engines, bars_by_key, detectors, observers=[tracker])
        service.flush_writes()
        for key, eng in engines.items():
            snap = eng.last
            log.info(
                "engine_ready",
                stream=str(key),
                bars=eng.bars_seen,
                ready=bool(snap and snap.ready),
                trend=str(snap.trend) if snap else None,
            )
        open_pos = [
            f"{t.symbol} {t.setup.side.name.lower()} ({t.status})" for t in tracker.active()
        ]
        log.info("paper_positions_after_warmup", positions=open_pos)

        pipeline = Pipeline(
            engines,
            detectors,
            notifier,
            recorder,
            backfill=lambda k, start: history.fetch_range(k, start),
            signal_mode=cfg.signal_mode,
            observers=[tracker],
            gate=gate,
            on_sent=[service.on_sent],
            ops=service.ops,
        )
        watchdog = FeedWatchdog(cfg.feed.stale_after_s, pipeline.on_watchdog)
        pipeline.watchdog = watchdog
        for key in keys:
            watchdog.register(stream_name(key))

        feeds = [
            BinanceKlineFeed(m, cfg.watchlist, cfg.timeframes, cfg.binance.ws(m), cfg.feed)
            for m in cfg.markets
        ]
        reporter = ReportWorker(
            pipeline.post_queue,
            notifier,
            load_events(cfg.alerts.events_file),
            cfg.alerts.events_horizon_days,
            cfg.alerts.chart_bars,
            cfg.alerts.chart_dir,
            on_error=lambda e: service.ops("report_failure", e),
        )
        strat_markets = {n: list(e.markets) for n, e in enabled.items()}

        async def weekly() -> str:
            since = now_ms() - 7 * 86_400_000
            return weekly_text(
                tracker,
                strat_markets,
                ref_means,
                since,
                await journal.ops_counts(since),
                await journal.alerts_since(since),
                recorder.summary(),
            )

        async def weekly_loop() -> None:
            while True:
                wait = seconds_until_weekly(
                    datetime.now(UTC), cfg.paper.weekly_weekday, cfg.paper.weekly_hour_utc
                )
                await asyncio.sleep(wait)
                try:
                    await notifier.send_message(await weekly())
                except Exception as e:
                    log.error("weekly_failed", error=repr(e))
                    service.ops("report_failure", "weekly")

        hb_file = cfg.alerts.heartbeat_file

        async def supervisor() -> None:
            """Pouls pour le healthcheck Docker + arrêt volontaire si un flux est mort."""
            hb_file.parent.mkdir(parents=True, exist_ok=True)
            while True:
                await asyncio.sleep(15)
                sil = watchdog.silence()
                worst = max(sil.values(), default=0.0)
                payload = json.dumps(
                    {
                        "ts": time.time(),
                        "bars": pipeline.bars_processed,
                        "worst_silence_s": round(worst, 1),
                        "stale": sorted(watchdog.stale),
                    }
                )
                await asyncio.to_thread(hb_file.write_text, payload)
                if worst > cfg.feed.restart_after_s:
                    with contextlib.suppress(Exception):
                        await notifier.send_message(
                            f"🔁 Flux muet depuis {worst / 60:.0f} min : redémarrage du "
                            "processus (relancé automatiquement par Docker)."
                        )
                    raise FatalRestart(f"flux muet {worst:.0f} s")

        async def daily_heartbeat() -> None:
            hour = cfg.alerts.daily_heartbeat_hour_utc
            if hour is None:
                return
            last_bars = pipeline.bars_processed
            while True:
                await asyncio.sleep(seconds_until_weekly(datetime.now(UTC), None, hour))
                n = pipeline.bars_processed - last_bars
                last_bars = pipeline.bars_processed
                mode = (
                    "PAUSE"
                    if gate.paused
                    else "OBSERVATION (coupe-circuit)"
                    if gate.observation
                    else "actif"
                )
                with contextlib.suppress(Exception):
                    await notifier.send_message(
                        f"💓 Sentinel en vie — mode {mode}, {n} mises à jour de marché en 24 h, "
                        f"{len(tracker.active())} position(s) papier, équité papier "
                        f"{tracker.equity():.2f} €. Sans ce message demain, le bot est arrêté."
                    )

        tasks = [
            asyncio.create_task(supervisor(), name="supervisor"),
            asyncio.create_task(daily_heartbeat(), name="heartbeat"),
            asyncio.create_task(pipeline.run(), name="pipeline"),
            asyncio.create_task(reporter.run(), name="reporter"),
            asyncio.create_task(watchdog.run(), name="watchdog"),
            asyncio.create_task(writer.run(), name="journal"),
            asyncio.create_task(service.run(), name="paper"),
            asyncio.create_task(weekly_loop(), name="weekly"),
            *(asyncio.create_task(f.run(pipeline.sink), name=f.name) for f in feeds),
        ]
        if telegram is not None and secrets.telegram_chat_id:
            ctx = CommandContext(
                gate,
                tracker,
                writer,
                recorder,
                watchdog,
                cfg.watchlist,
                cfg.markets,
                [tf.value for tf in cfg.timeframes],
                strat_markets,
                ref_means,
                time.monotonic(),
                weekly,
            )
            bot = CommandBot(telegram, secrets.telegram_chat_id, Commands(ctx))
            tasks.append(asyncio.create_task(bot.run(), name="commands"))
        mode = (
            " — ⏸️ EN PAUSE (/resume)"
            if gate.paused
            else (" — ⛔ MODE OBSERVATION (coupe-circuit)" if gate.observation else "")
        )
        await notifier.send_message(
            f"🟢 Sentinel démarré{mode} — {len(keys)} flux ({', '.join(cfg.watchlist)}), "
            f"signal à la {'clôture' if cfg.signal_mode == 'close' else 'volée (intrabar)'}.\n"
            f"Stratégies actives : {', '.join(d.name for d in strat_dets) or 'aucune'}.\n"
            f"Positions papier en cours : {'; '.join(open_pos) or 'aucune'}.\n"
            "Outil d'aide à la décision : aucun ordre n'est passé automatiquement. /help"
        )
        # Arrêt propre sur SIGTERM (docker stop / mise à jour) et SIGINT : on vide le journal
        # avant de quitter. Sans cela, les dernières écritures en file seraient perdues.
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            with contextlib.suppress(NotImplementedError):  # Windows
                loop.add_signal_handler(sig, stop.set)
        waiters = [asyncio.create_task(stop.wait(), name="stop"), *tasks]
        if duration_s:
            waiters.append(asyncio.create_task(asyncio.sleep(duration_s), name="duration"))
        try:
            done, _ = await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                if t.get_name() not in ("stop", "duration") and t.exception() is not None:
                    raise t.exception()  # type: ignore[misc]
            log.info("shutdown", reason=next(iter(done)).get_name())
        finally:
            for w in waiters[:1] + waiters[len(tasks) + 1 :]:
                w.cancel()
            for f in feeds:
                f.stop()
            await pipeline.drain()
            service.flush_writes()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(writer.flush(), timeout=5)
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await journal.close()
            if telegram:
                await telegram.aclose()
        summary = recorder.summary()
        summary["bars_processed"] = float(pipeline.bars_processed)
        summary["reconnects"] = float(sum(f.reconnects for f in feeds))
        return summary


def main() -> None:
    ap = argparse.ArgumentParser(prog="sentinel")
    ap.add_argument(
        "--config",
        action="append",
        default=None,
        help="YAML de config (répétable, le dernier l'emporte)",
    )
    ap.add_argument("--dry-run", action="store_true", help="affiche au lieu d'envoyer sur Telegram")
    ap.add_argument(
        "--probe",
        action="store_true",
        help="alerte de test à chaque bougie clôturée (mesure de latence)",
    )
    ap.add_argument("--duration", type=float, default=None, help="s'arrêter après N secondes")
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    configure_logging(args.log_level)
    paths = args.config or ["config/config.yaml"]
    cfg = load_config(*[Path(p) for p in paths])
    try:
        summary = asyncio.run(
            run(cfg, Secrets(), dry_run=args.dry_run, probe=args.probe, duration_s=args.duration)
        )
    except FatalRestart as e:
        log.error("fatal_restart", reason=str(e))
        raise SystemExit(3) from None
    print(json.dumps({"latency_summary": summary}, indent=2))


if __name__ == "__main__":
    main()
