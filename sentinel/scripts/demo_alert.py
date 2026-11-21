"""Démonstration : génère l'alerte n°1, le rapport n°2 et le graphique du DERNIER signal réel
de chaque stratégie activée, en rejouant les archives Binance (aucun réseau nécessaire).

    uv run python scripts/demo_alert.py          # → reports/demo/*.txt et *.png

Avec --send, envoie aussi le dernier signal sur ton Telegram (TELEGRAM_* dans .env).
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime
from pathlib import Path

from sentinel.alerts.chart import render_chart
from sentinel.alerts.events import load_events, upcoming
from sentinel.alerts.format import format_alert, format_report
from sentinel.alerts.telegram import TelegramClient
from sentinel.backtest.data import load_bars
from sentinel.core.config import Secrets, load_config
from sentinel.core.logging import configure_logging
from sentinel.core.models import Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine
from sentinel.pipeline.strategy_detector import AlertContext, StrategyDetector, load_stats
from sentinel.strategies.registry import strategy_factory

ROOT = Path("data/archive")
OUT = Path("reports/demo")


def last_signals(cfg_path: str, name: str, symbols: list[str]) -> dict[str, AlertContext]:
    """Rejoue TOUS les actifs ensemble dans un seul détecteur, comme en production : chaque
    alerte connaît les positions virtuelles déjà ouvertes sur les autres actifs."""
    cfg = load_config(cfg_path)
    entry = cfg.strategies[name]
    bars = {
        StreamKey(Market.SPOT, sym, tf): load_bars(ROOT, Market.SPOT, sym, tf)
        for sym in symbols
        for tf in (Timeframe.H4, Timeframe.D1)
    }
    engines = {k: IndicatorEngine(k, cfg.indicators, strict_gaps=False) for k in bars}
    det = StrategyDetector(
        strategy_factory(name, entry),
        entry.markets,
        engines,
        cfg.risk,
        load_stats(cfg.alerts.stats_dir, name),
        format_alert,
    )
    events = sorted(
        ((b.close_time_ms, -k.timeframe.seconds, k, b) for k, bs in bars.items() for b in bs),
        key=lambda e: (e[0], e[1]),
    )
    last: dict[str, AlertContext] = {}
    for _, _, k, b in events:
        snap = engines[k].update(b)
        if snap is None:
            continue
        sig = det.evaluate(snap, b)
        if sig is not None and isinstance(sig.payload, AlertContext):
            last[b.symbol] = sig.payload
    return last


async def main(send: bool) -> None:
    configure_logging("WARNING")
    cfg = load_config("config/config.yaml")
    events = load_events(cfg.alerts.events_file)
    latest: tuple[str, str, bytes] | None = None
    for name, entry in cfg.strategies.items():
        if not entry.enabled:
            continue
        found = last_signals("config/config.yaml", name, cfg.watchlist)
        for sym in cfg.watchlist:
            ctx = found.get(sym)
            if ctx is None:
                print(f"{name} {sym} : aucun signal dans l'historique")
                continue
            when = datetime.fromtimestamp(ctx.bar.close_time_ms / 1000, UTC)
            msg1 = format_alert(ctx)
            msg2 = format_report(ctx, upcoming(events, when, cfg.alerts.events_horizon_days))
            png = render_chart(ctx, cfg.alerts.chart_bars)
            stem = f"{name}_{sym}_{when:%Y%m%d}"
            (OUT / f"{stem}.txt").write_text(msg1 + "\n\n" + "─" * 40 + "\n\n" + msg2, "utf-8")
            (OUT / f"{stem}.png").write_bytes(png)
            print(f"\n{'═' * 70}\n{name} · {sym} · signal du {when:%Y-%m-%d}\n{'═' * 70}")
            print(msg1)
            print("\n" + "─" * 40)
            print(msg2)
            print(f"\n→ graphique : {OUT / (stem + '.png')}")
            latest = (msg1, msg2, png)
    if send and latest:
        sec = Secrets()
        if not (sec.telegram_bot_token and sec.telegram_chat_id):
            raise SystemExit("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID manquants dans .env")
        async with TelegramClient(sec.telegram_bot_token, sec.telegram_chat_id) as tg:
            m1 = await tg.send_message(
                "[DÉMO — signal historique, pas une alerte live]\n" + latest[0]
            )
            m2 = await tg.send_message(latest[1], reply_to=m1.message_id)
            await tg.send_photo(latest[2], "Démo — graphique", reply_to=m2.message_id)
        print("Envoyé sur Telegram.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true")
    OUT.mkdir(parents=True, exist_ok=True)
    asyncio.run(main(ap.parse_args().send))
