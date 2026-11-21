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
from pathlib import Path

import httpx

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
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import (
    Detector,
    Pipeline,
    ProbeDetector,
    stream_name,
    warm_up,
)
from sentinel.pipeline.strategy_detector import StrategyDetector, load_stats
from sentinel.strategies.registry import strategy_factory

log = get_logger("sentinel")


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

        detectors: list[Detector] = [ProbeDetector()] if probe else []
        strat_dets: list[StrategyDetector] = []
        for name, entry in cfg.strategies.items():
            if not entry.enabled:
                continue
            det = StrategyDetector(
                strategy_factory(name, entry),
                entry.markets,
                engines,
                cfg.risk,
                load_stats(cfg.alerts.stats_dir, name),
                format_alert,
            )
            strat_dets.append(det)
            detectors.append(det)
        warm_up(engines, bars_by_key, detectors)
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
            f"{d.name} {m}:{sym} {p.side.name} stop {p.stop:g}"
            for d in strat_dets
            for (m, sym), p in d.open_positions().items()
        ]
        log.info("virtual_positions_after_warmup", positions=open_pos)

        pipeline = Pipeline(
            engines,
            detectors,
            notifier,
            recorder,
            backfill=lambda k, start: history.fetch_range(k, start),
            signal_mode=cfg.signal_mode,
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
        )
        tasks = [
            asyncio.create_task(pipeline.run(), name="pipeline"),
            asyncio.create_task(reporter.run(), name="reporter"),
            asyncio.create_task(watchdog.run(), name="watchdog"),
            *(asyncio.create_task(f.run(pipeline.sink), name=f.name) for f in feeds),
        ]
        await notifier.send_message(
            f"🟢 Sentinel démarré — {len(keys)} flux ({', '.join(cfg.watchlist)}), "
            f"signal à la {'clôture' if cfg.signal_mode == 'close' else 'volée (intrabar)'}.\n"
            f"Stratégies actives : {', '.join(d.name for d in strat_dets) or 'aucune'}.\n"
            f"Positions virtuelles en cours : {'; '.join(open_pos) or 'aucune'}.\n"
            "Outil d'aide à la décision : aucun ordre n'est passé automatiquement."
        )
        try:
            if duration_s:
                await asyncio.sleep(duration_s)
            else:
                await asyncio.gather(*tasks)
        finally:
            for f in feeds:
                f.stop()
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await pipeline.drain()
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
    summary = asyncio.run(
        run(cfg, Secrets(), dry_run=args.dry_run, probe=args.probe, duration_s=args.duration)
    )
    print(json.dumps({"latency_summary": summary}, indent=2))


if __name__ == "__main__":
    main()
