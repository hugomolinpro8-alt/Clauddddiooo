"""Phase 4 : paper trading, journal, coupe-circuit, divergence, commandes, rapport hebdo."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import pytest

from sentinel.alerts.commands import CommandBot, CommandContext, Commands
from sentinel.alerts.console import ConsoleNotifier
from sentinel.alerts.format import format_alert
from sentinel.alerts.telegram import SentMessage
from sentinel.backtest.costs import CostModel
from sentinel.backtest.engine import Backtester
from sentinel.core.config import IndicatorConfig, RiskConfig
from sentinel.core.models import Bar, Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine
from sentinel.journal.db import Journal, JournalWriter
from sentinel.paper.divergence import divergence_test
from sentinel.paper.reporting import weekly_text
from sentinel.paper.service import PaperService
from sentinel.paper.tracker import PaperTracker
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import OBSERVATION_BANNER, Gate, Pipeline, warm_up
from sentinel.pipeline.strategy_detector import StrategyDetector
from sentinel.strategies.donchian import DonchianParams, DonchianTrend
from tests.helpers import random_bars

DAY = 86_400_000


def keyfor(sym: str) -> StreamKey:
    return StreamKey(Market.SPOT, sym, Timeframe.D1)


def bars_for(sym: str, seed: int, n: int = 900) -> list[Bar]:
    return random_bars(n, keyfor(sym), seed=seed, start_ms=1_600_000_000_000 // DAY * DAY)


class Recorder(ConsoleNotifier):
    def __init__(self) -> None:
        super().__init__()
        self.texts: list[str] = []

    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage:
        self.texts.append(text)
        return SentMessage(len(self.texts), time.perf_counter_ns(), 0.0)


class System:
    """Le pipeline live complet, sans réseau : détecteur → envoi → crochet → paper."""

    def __init__(
        self,
        symbols: list[str],
        risk: RiskConfig | None = None,
        ref: dict[str, list[float]] | None = None,
    ) -> None:
        self.risk = risk or RiskConfig()
        self.engines = {keyfor(s): IndicatorEngine(keyfor(s), IndicatorConfig()) for s in symbols}
        self.tracker = PaperTracker(self.risk, ref_oos_r=ref or {})
        self.notifier = Recorder()
        self.det = StrategyDetector(
            lambda: DonchianTrend(DonchianParams()),
            [Market.SPOT],
            self.engines,
            self.risk,
            {},
            format_alert,
            open_risk_pct=self.tracker.open_risk_pct,
        )
        self.journal_writes: list[tuple[str, tuple[Any, ...]]] = []
        self.writer = JournalWriter(None)  # type: ignore[arg-type]
        self.writer.put = lambda m, *a: self.journal_writes.append((m, a))  # type: ignore[method-assign]
        self.service = PaperService(self.tracker, self.writer, self.notifier)
        self.gate = Gate(observation=lambda: self.tracker.breaker_tripped)
        self.pipe = Pipeline(
            self.engines,
            [self.det],
            self.notifier,
            LatencyRecorder(),
            observers=[self.tracker],
            gate=self.gate,
            on_sent=[self.service.on_sent],
            ops=self.service.ops,
        )

    async def feed(self, bars: list[Bar]) -> None:
        for b in sorted(bars, key=lambda x: (x.close_time_ms, x.symbol)):
            self.pipe.process(b)
            await self.pipe.drain()


async def test_paper_trades_equal_backtest_trades_exactly() -> None:
    """LE test de la phase 4 : rejouer l'historique à travers le système LIVE complet produit
    exactement les trades du backtest (mêmes entrées, mêmes sorties, mêmes R). Un écart
    futur entre paper et backtest ne pourra donc venir que du marché."""
    bars = bars_for("BTCUSDT", 11)
    sys_ = System(["BTCUSDT"], RiskConfig(max_open_risk_pct=100))
    await sys_.feed(bars)
    bt = Backtester(lambda: DonchianTrend(DonchianParams()), CostModel.for_market(Market.SPOT))
    trades = bt.run("BTCUSDT", Market.SPOT, {Timeframe.D1: bars})
    closed = sorted(
        (t for t in sys_.tracker.trades.values() if t.status == "closed"), key=lambda t: t.id
    )
    bt_closed = [t for t in trades if t.exit_reason != "fin_donnees"]
    assert len(bt_closed) >= 5
    assert [(t.result.entry_ms, t.result.exit_ms) for t in closed if t.result] == [
        (t.entry_ms, t.exit_ms) for t in bt_closed
    ]
    for p, b in zip(closed, bt_closed, strict=True):
        assert p.result is not None
        assert p.result.r_net == pytest.approx(b.r_net, abs=1e-12)


async def test_restart_from_journal_catches_up_missed_bars(tmp_path: Path) -> None:
    """Arrêt pendant une position ouverte, redémarrage plus tard : le trade est rechargé du
    journal SQLite et rejoué sur les bougies manquées → même résultat que sans arrêt."""
    bars = bars_for("BTCUSDT", 11)
    ref = System(["BTCUSDT"], RiskConfig(max_open_risk_pct=100))
    await ref.feed(bars)
    # point d'arrêt : pendant le premier trade ouvert
    first = next(
        t
        for t in sorted(ref.tracker.trades.values(), key=lambda t: t.id)
        if t.result is not None and t.result.bars_held >= 10
    )
    assert first.result is not None
    stop_ms = first.result.entry_ms + first.result.bars_held // 2 * DAY
    cut = next(i for i, b in enumerate(bars) if b.open_time_ms >= stop_ms)

    j = await Journal(tmp_path / "j.sqlite").open()
    try:
        a = System(["BTCUSDT"], RiskConfig(max_open_risk_pct=100))
        await a.feed(bars[:cut])
        a.service.flush_writes()  # en production : tâche `run` chaque seconde + à l'arrêt
        for m, args in a.journal_writes:
            await getattr(j, m)(*args)
        rows = await j.paper(("pending", "open", "closed", "cancelled"))
        next_alert = await j.max_id("alerts") + 1
    finally:
        await j.close()
    assert any(r.status == "open" for r in rows)

    # redémarrage : nouveau processus, chargement du journal AVANT la chauffe
    b = System(["BTCUSDT"], RiskConfig(max_open_risk_pct=100))
    b.tracker.load(rows, next_alert, None, False)
    warm_up(b.engines, {keyfor("BTCUSDT"): bars[: cut + 20]}, [b.det], observers=[b.tracker])
    await b.feed(bars[cut + 20 :])
    got = {t.id: t.result.r_net for t in b.tracker.trades.values() if t.result}
    want = {t.id: t.result.r_net for t in ref.tracker.trades.values() if t.result}
    assert got[first.id] == pytest.approx(want[first.id])


async def test_correlated_risk_cap_reduces_then_blocks() -> None:
    risk = RiskConfig(risk_per_trade_pct=0.5, max_open_risk_pct=0.8)
    tr = PaperTracker(risk)
    b = bars_for("BTCUSDT", 1, 2)[0]
    from sentinel.strategies.base import Setup, Side

    s = Setup("x", Side.LONG, 100.0, 90.0, float("inf"), 0.5, 1e9, 10**9, "t", b.close_time_ms)
    t1 = tr.add_from_alert(s, b, 1, 1)
    t2 = tr.add_from_alert(s, b, 2, 2)
    t3 = tr.add_from_alert(s, b, 3, 3)
    assert t1 is not None and t1.risk_amount == pytest.approx(15.0)  # 0,5 % de 3 000 €
    assert t2 is not None and t2.risk_amount == pytest.approx(9.0)  # réduit : 0,8 − 0,5 = 0,3 %
    assert t3 is None  # plafond atteint
    assert any("plafond de risque" in m for m, _ in tr.outbox.messages)


async def test_pause_mutes_alerts_but_paper_continues() -> None:
    sys_ = System(["BTCUSDT"], RiskConfig(max_open_risk_pct=100))
    sys_.gate.paused = True
    await sys_.feed(bars_for("BTCUSDT", 11))
    assert not any(t.startswith("🟢") for t in sys_.notifier.texts)  # aucune alerte envoyée
    assert sys_.pipe.alerts_muted >= 5
    assert len(sys_.tracker.closed()) >= 5  # le paper trading a suivi les signaux
    muted = [a[0] for m, a in sys_.journal_writes if m == "insert_alert"]
    assert muted and all(r["muted"] == 1 for r in muted)


async def test_breaker_switches_to_observation_mode() -> None:
    sys_ = System(["BTCUSDT"], RiskConfig(max_drawdown_pct=0.5, max_open_risk_pct=100))
    await sys_.feed(bars_for("BTCUSDT", 11))
    assert sys_.tracker.breaker_tripped
    alerts = [t for t in sys_.notifier.texts if "LONG BTCUSDT" in t]
    assert any(t.startswith(OBSERVATION_BANNER) for t in alerts)
    assert (
        any("COUPE-CIRCUIT" in m for m, _ in sys_.tracker.outbox.messages)
        or any("COUPE-CIRCUIT" in t for t in sys_.notifier.texts)
        or sys_.tracker.breaker_tripped
    )


def test_divergence_test_sanity() -> None:
    ref = [3.0, -1.0, -1.0, 2.0, -1.0, 5.0, -1.0, -0.5, 1.0, -1.0, 4.0, -1.0]
    assert divergence_test([-1.0] * 5, ref) is None  # trop peu de trades
    bad = divergence_test([-1.0] * 10, ref)
    assert bad is not None and bad.diverging and bad.p_value < 0.01
    ok = divergence_test([3.0, -1.0, -1.0, 2.0, -1.0, 1.0, -1.0, 4.0], ref)
    assert ok is not None and not ok.diverging


async def test_divergence_alert_proposes_suspension() -> None:
    great_ref = [10.0] * 30 + [-1.0] * 10  # backtest irréaliste → le paper « diverge »
    sys_ = System(
        ["BTCUSDT"], RiskConfig(max_open_risk_pct=100), ref={"donchian_trend:spot": great_ref}
    )
    sys_.tracker.div_min = 5
    await sys_.feed(bars_for("BTCUSDT", 11))
    msgs = [m for m, _ in sys_.tracker.outbox.messages] + sys_.notifier.texts
    assert any("DIVERGENCE" in m and "SUSPENDRE" in m for m in msgs)


class FakeTransport:
    def __init__(self, updates: list[dict[str, Any]]) -> None:
        self.updates = updates
        self.sent: list[tuple[str, int | None]] = []

    async def get_updates(self, offset: int | None, timeout_s: int = 30) -> list[dict[str, Any]]:
        u, self.updates = self.updates, []
        return u

    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage:
        self.sent.append((text, reply_to))
        return SentMessage(1, 0, 0.0)


def _upd(i: int, chat: int, text: str) -> dict[str, Any]:
    return {
        "update_id": i,
        "message": {
            "message_id": 100 + i,
            "chat": {"id": chat},
            "date": int(time.time()),
            "text": text,
        },
    }


async def test_commands_authorized_only_and_pause_resume() -> None:
    sys_ = System(["BTCUSDT"])

    async def weekly() -> str:
        return "hebdo"

    ctx = CommandContext(
        sys_.gate,
        sys_.tracker,
        sys_.writer,
        LatencyRecorder(),
        None,
        ["BTCUSDT"],
        [Market.SPOT],
        ["1d"],
        {"donchian_trend": [Market.SPOT]},
        {"donchian_trend:spot": 1.36},
        time.monotonic(),
        weekly,
    )
    tr = FakeTransport(
        [
            _upd(1, 999, "/pause"),
            _upd(2, 42, "/pause"),
            _upd(3, 42, "/status"),
            _upd(4, 42, "/resume"),
            _upd(5, 42, "/stats"),
            _upd(6, 42, "/wallets"),
            _upd(7, 42, "/inconnue"),
            _upd(8, 42, "/weekly"),
        ]
    )
    bot = CommandBot(tr, "42", Commands(ctx))
    await bot.poll_once()
    assert bot.rejected == 1  # chat 999 ignoré
    texts = [t for t, _ in tr.sent]
    assert texts[0].startswith("⏸️ Alertes suspendues")
    assert "PAUSE" in texts[1]  # /status pendant la pause
    assert texts[2].startswith("▶️") and not sys_.gate.paused
    assert "STATISTIQUES PAPER" in texts[3] and "backtest hors échantillon" in texts[3]
    assert "non actif (phase 6)" in texts[4]
    assert "Commande inconnue" in texts[5]
    assert texts[6] == "hebdo"
    assert tr.sent[0][1] == 102  # répond au message de la commande


async def test_weekly_report_sections() -> None:
    sys_ = System(["BTCUSDT"], RiskConfig(max_open_risk_pct=100))
    await sys_.feed(bars_for("BTCUSDT", 11))
    text = weekly_text(
        sys_.tracker,
        {"donchian_trend": [Market.SPOT]},
        {"donchian_trend:spot": 1.36},
        0,
        {"gap": 2, "feed_stale": 1},
        7,
        {"n": 3, "system_ms_p50": 120.0, "system_ms_p99": 300.0},
    )
    for needle in (
        "RAPPORT HEBDOMADAIRE",
        "Performance par stratégie",
        "Smart money",
        "Erreurs et points à corriger",
        "2 trous de données",
        "1 coupures de flux",
        "p99 300 ms",
        "backtest hors échantillon",
    ):
        assert needle in text, needle
    assert "garanti" not in text.lower()


def test_weekly_schedule() -> None:
    from datetime import UTC, datetime

    from sentinel.app import seconds_until_weekly

    sun = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)  # dimanche
    assert seconds_until_weekly(sun, 0, 7) == pytest.approx(19 * 3600)  # lundi 07:00
    mon = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)
    assert seconds_until_weekly(mon, 0, 7) == pytest.approx(7 * 86400 - 3600)


async def test_journal_roundtrip(tmp_path: Path) -> None:
    j = await Journal(tmp_path / "x.sqlite").open()
    w = JournalWriter(j)
    task = asyncio.create_task(w.run())
    w.put("set_state", "paused", True)
    w.put("log_ops", 1000, "gap", "x")
    w.put("log_ops", 2000, "gap", "y")
    await w.flush()
    task.cancel()
    assert await j.get_state("paused") is True
    assert await j.ops_counts(0) == {"gap": 2}
    await j.close()
