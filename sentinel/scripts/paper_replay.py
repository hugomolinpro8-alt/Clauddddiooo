"""Rejoue l'historique réel à travers le SYSTÈME LIVE COMPLET (détecteur, envoi, journal,
paper trading, plafond de risque, coupe-circuit, divergence) et compare au backtest.

    uv run python scripts/paper_replay.py [--from 2023-01-01]

Chauffe sur les données antérieures à --from (sans alerte), puis « live » de --from à la fin.
Rien n'est envoyé : les messages sont comptés et les derniers affichés.
"""

from __future__ import annotations

import argparse
import asyncio
import time
from collections import Counter
from dataclasses import replace
from pathlib import Path

import numpy as np

from sentinel.alerts.format import format_alert
from sentinel.alerts.telegram import SentMessage
from sentinel.backtest.costs import CostModel
from sentinel.backtest.data import load_bars, ms
from sentinel.backtest.engine import Backtester
from sentinel.core.config import load_config
from sentinel.core.logging import configure_logging
from sentinel.core.models import Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine
from sentinel.journal.db import JournalWriter
from sentinel.paper.reporting import stats_text, weekly_text
from sentinel.paper.service import PaperService
from sentinel.paper.tracker import PaperTracker
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import Gate, Pipeline, warm_up
from sentinel.pipeline.strategy_detector import StrategyDetector, load_reference_r, load_stats
from sentinel.strategies.donchian import DonchianParams, DonchianTrend
from sentinel.strategies.registry import strategy_factory

ROOT = Path("data/archive")


class Silent:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage:
        self.texts.append(text)
        return SentMessage(len(self.texts), time.perf_counter_ns(), 0.0)


async def main(start: str) -> None:
    configure_logging("ERROR")
    cfg = load_config("config/config.yaml")
    name, entry = "donchian_trend", cfg.strategies["donchian_trend"]
    t0 = ms(start)
    tfs = (Timeframe.H4, Timeframe.D1)
    bars = {
        StreamKey(Market.SPOT, s, tf): load_bars(ROOT, Market.SPOT, s, tf)
        for s in cfg.watchlist
        for tf in tfs
    }
    engines = {k: IndicatorEngine(k, cfg.indicators, strict_gaps=False) for k in bars}
    ref = load_reference_r(cfg.alerts.stats_dir, name)
    tracker = PaperTracker(cfg.risk, ref_oos_r=ref)
    notifier = Silent()
    writes: Counter[str] = Counter()
    writer = JournalWriter(None)  # type: ignore[arg-type]
    writer.put = lambda m, *a: writes.update([m])  # type: ignore[method-assign]
    service = PaperService(tracker, writer, notifier)
    det = StrategyDetector(
        strategy_factory(name, entry),
        entry.markets,
        engines,
        cfg.risk,
        load_stats(cfg.alerts.stats_dir, name),
        format_alert,
        open_risk_pct=tracker.open_risk_pct,
    )
    gate = Gate(observation=lambda: tracker.breaker_tripped)
    pipe = Pipeline(
        engines,
        [det],
        notifier,
        LatencyRecorder(),
        observers=[tracker],
        gate=gate,
        on_sent=[service.on_sent],
        ops=service.ops,
    )

    warm_up(
        engines,
        {k: [b for b in v if b.close_time_ms < t0] for k, v in bars.items()},
        [det],
        observers=[tracker],
    )
    live = sorted(
        (
            (b.close_time_ms, -k.timeframe.seconds, b)
            for k, v in bars.items()
            for b in v
            if b.close_time_ms >= t0
        ),
        key=lambda e: (e[0], e[1]),
    )
    paper_msgs: list[str] = []
    for _, _, b in live:
        # horodatage de réception au moment du rejeu : la latence mesurée est alors celle de
        # notre code (sans réseau ni Telegram), et non l'âge de la bougie d'archive.
        b = replace(b, recv_mono_ns=time.perf_counter_ns(), event_time_ms=time.time_ns() // 10**6)
        pipe.process(b)
        await pipe.drain()
        paper_msgs += [m for m, _ in service.flush_now()]

    closed = tracker.closed(name)
    r = [t.result.r_net for t in closed if t.result]
    print(f"Période « live » simulée : {start} → fin des données")
    print(
        f"Alertes envoyées : {pipe.alerts_sent} | messages paper : {len(paper_msgs)} | "
        f"écritures journal : {dict(writes)}"
    )
    print(
        f"Trades papier clôturés : {len(r)}, espérance {np.mean(r):+.3f} R, total {sum(r):+.1f} R, "
        f"P&L {sum(t.pnl_eur() for t in closed):+.2f} € sur {cfg.risk.capital_eur:.0f} €"
    )
    print(
        f"Équité papier finale {tracker.equity():.2f} €, plus haut {tracker.peak_equity:.2f} €, "
        f"drawdown actuel {tracker.drawdown() * 100:.1f} %, coupe-circuit : "
        f"{'DÉCLENCHÉ' if tracker.breaker_tripped else 'non'}"
    )
    skipped = sum("plafond de risque" in m for m in paper_msgs)
    print(f"Trades refusés par le plafond de risque corrélé : {skipped}")

    # Comparaison au backtest, trade par trade (même période, mêmes règles)
    bt_r: list[float] = []
    for s in cfg.watchlist:
        b = Backtester(lambda: DonchianTrend(DonchianParams()), CostModel.for_market(Market.SPOT))
        k = StreamKey(Market.SPOT, s, Timeframe.D1)
        bt_r += [
            t.r_net
            for t in b.run(s, Market.SPOT, {Timeframe.D1: bars[k]})
            if t.entry_ms >= t0 and t.exit_reason != "fin_donnees"
        ]
    print(
        f"Backtest, mêmes trades clôturés : {len(bt_r)} trades, espérance {np.mean(bt_r):+.3f} R "
        f"(écart paper − backtest : {np.mean(r) - np.mean(bt_r):+.4f} R ; un écart non nul vient "
        "uniquement des trades refusés par le plafond de risque)"
    )

    print(
        "\n"
        + "=" * 60
        + "\n"
        + stats_text(tracker, {name: [Market.SPOT]}, {k: float(np.mean(v)) for k, v in ref.items()})
    )
    last_bar_ms = live[-1][0]
    print(
        "\n"
        + "=" * 60
        + "\n"
        + weekly_text(
            tracker,
            {name: [Market.SPOT]},
            {k: float(np.mean(v)) for k, v in ref.items()},
            last_bar_ms - 7 * 86_400_000,
            dict(service.ops_counter),
            0,
            pipe.recorder.summary(),
        )
    )
    print("\n" + "=" * 60 + "\nDerniers messages paper :")
    for m in paper_msgs[-6:]:
        print("  " + m)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="2023-01-01")
    asyncio.run(main(ap.parse_args().start))
