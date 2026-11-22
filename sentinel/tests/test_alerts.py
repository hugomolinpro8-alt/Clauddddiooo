"""Phase 3 : cohérence live/backtest, formatage des messages, flux complet vers Telegram."""

from __future__ import annotations

import asyncio
import math
import time

import pytest
from aiohttp import web
from pydantic import SecretStr

from sentinel.alerts.chart import render_chart
from sentinel.alerts.events import RiskEvent
from sentinel.alerts.format import (
    FORBIDDEN_WORDS,
    confluences_and_risks,
    fmt_price,
    format_alert,
    format_report,
)
from sentinel.alerts.reporter import ReportWorker
from sentinel.alerts.telegram import TelegramClient
from sentinel.backtest.costs import CostModel
from sentinel.backtest.engine import Backtester
from sentinel.core.config import IndicatorConfig, RiskConfig
from sentinel.core.models import Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import Pipeline, warm_up
from sentinel.pipeline.strategy_detector import AlertContext, AssetStats, StrategyDetector
from sentinel.risk.sizing import position_size
from sentinel.strategies.donchian import DonchianParams, DonchianTrend
from tests.helpers import random_bars

KEY = StreamKey(Market.SPOT, "BTCUSDT", Timeframe.D1)
TOKEN = "1234567890:AAFakeTokenForTestsOnly_abcdefghijklmn"
STATS = {"spot:BTCUSDT": AssetStats(24, 0.5, 3.49, 14, 0.43, 1.05, 7.75, -0.77)}


def _bars(n: int = 900, seed: int = 11) -> list:  # type: ignore[type-arg]
    return random_bars(n, KEY, seed=seed, start_ms=1_600_000_000_000 // 86_400_000 * 86_400_000)


def _detector(engines: dict[StreamKey, IndicatorEngine]) -> StrategyDetector:
    return StrategyDetector(
        lambda: DonchianTrend(DonchianParams()),
        [Market.SPOT],
        engines,
        RiskConfig(),
        STATS,
        format_alert,
    )


def _collect_signals(bars: list) -> tuple[StrategyDetector, list]:  # type: ignore[type-arg]
    engines = {KEY: IndicatorEngine(KEY, IndicatorConfig())}
    det = _detector(engines)
    sigs = []
    for b in bars:
        snap = engines[KEY].update(b)
        assert snap is not None
        sig = det.evaluate(snap, b)
        if sig is not None:
            sigs.append(sig)
    return det, sigs


def test_live_detector_emits_same_signals_as_backtest() -> None:
    """Le cœur de la phase 3 : les alertes live correspondent aux trades du backtest. Sinon,
    les statistiques citées dans les alertes ne décriraient pas ce que fait le bot."""
    bars = _bars()
    _, sigs = _collect_signals(bars)
    bt = Backtester(lambda: DonchianTrend(DonchianParams()), CostModel.zero())
    trades = bt.run("BTCUSDT", Market.SPOT, {Timeframe.D1: bars})
    live_times = [s.payload.setup.time_ms for s in sigs]
    bt_times = [t.signal_ms for t in trades]
    assert len(bt_times) >= 5
    # Seule différence admise : un trade annulé en backtest car l'ouverture suivante était déjà
    # au-delà du stop (gap). Le live, lui, a déjà envoyé l'alerte à la clôture.
    assert set(bt_times) <= set(live_times)
    assert len(live_times) - len(bt_times) <= 1


def test_warm_up_reproduces_virtual_positions() -> None:
    """Redémarrer le bot (chauffe sur l'historique) donne le même état que s'il avait
    tourné sans interruption."""
    bars = _bars()
    det_live, _ = _collect_signals(bars)
    engines = {KEY: IndicatorEngine(KEY, IndicatorConfig())}
    det_warm = _detector(engines)
    warm_up(engines, {KEY: bars}, [det_warm])
    assert det_warm.open_positions().keys() == det_live.open_positions().keys()
    for k, p in det_live.open_positions().items():
        assert det_warm.open_positions()[k].stop == pytest.approx(p.stop)


def _ctx() -> AlertContext:
    _, sigs = _collect_signals(_bars())
    ctx = sigs[-1].payload
    assert isinstance(ctx, AlertContext)
    return ctx


def test_alert_format_fields() -> None:
    text = format_alert(_ctx())
    first = text.splitlines()[0]
    assert first.startswith("🟢 LONG BTCUSDT (spot)")
    for needle in (
        "Entrée ≈",
        "Stop :",
        "Objectif : aucun",
        "Repères : +2R",
        "Risque : 0,5",
        "taille suggérée",
        "Stratégie : cassure du plus haut 55 jours",
        "Smart money",
        "Backtest (BTC spot, cette stratégie) : 24 trades",
    ):
        assert needle in text, needle
    assert len(text) < 1000  # message court, lisible sur téléphone


def test_report_has_all_sections_and_counterarguments() -> None:
    ctx = _ctx()
    ev = [
        RiskEvent(
            __import__("datetime").datetime(2030, 1, 1, tzinfo=__import__("datetime").UTC),
            "Décision FOMC",
            "élevé",
        )
    ]
    text = format_report(ctx, ev)
    for sec in (
        "🎯 Thèse",
        "🧭 Contexte",
        "✅ Confluences",
        "⚠️ Contre-arguments",
        "🛑 Invalidation",
        "🧰 Gestion",
        "📅 Événements à risque",
        "Décision FOMC",
    ):
        assert sec in text, sec
    _, con = confluences_and_risks(ctx)
    assert len(con) >= 3  # jamais vide : au minimum corrélation + profil de la stratégie
    assert len(text) <= 4096
    low = text.lower()
    assert not any(w in low for w in FORBIDDEN_WORDS)


def test_price_formatting_french() -> None:
    assert fmt_price(67450.3) == "67 450"
    assert fmt_price(1682.93) == "1 683"
    assert fmt_price(70.304) == "70,30"
    assert fmt_price(0.43061) == "0,4306"


def test_position_sizing() -> None:
    p = position_size(3000, 0.5, 60_000, 55_200, Market.SPOT)
    assert p.risk_amount == pytest.approx(15.0)
    assert p.qty == pytest.approx(15 / 4800)
    assert not p.capped and p.capital_share == pytest.approx(15 / 4800 * 60_000 / 3000)
    tight = position_size(3000, 0.5, 100, 99.9, Market.SPOT)  # stop à 0,1 % → 15 000 € > capital
    assert tight.capped and tight.notional == pytest.approx(3000)
    assert tight.risk_amount == pytest.approx(3.0)  # risque réel inférieur, signalé
    perp = position_size(3000, 0.5, 100, 99.9, Market.PERP, max_leverage=10)
    assert perp.leverage == pytest.approx(5.0) and perp.liq_distance_pct is not None
    assert perp.liq_distance_pct > perp.stop_distance_pct  # liquidation bien au-delà du stop


def test_chart_renders_png() -> None:
    png = render_chart(_ctx())
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 10_000


async def test_full_flow_alert_then_report_then_chart() -> None:
    """Message n°1 immédiat, puis rapport EN RÉPONSE au n°1, puis graphique en réponse au
    rapport. Le rapport (lent) ne retarde pas l'alerte."""
    calls: list[tuple[str, dict[str, object], float]] = []
    counter = 0

    async def send_message(req: web.Request) -> web.Response:
        nonlocal counter
        body = await req.json()
        counter += 1
        calls.append(("message", body, time.perf_counter()))
        return web.json_response({"ok": True, "result": {"message_id": counter}})

    async def send_photo(req: web.Request) -> web.Response:
        nonlocal counter
        form = await req.post()
        counter += 1
        photo = form["photo"]
        calls.append(
            (
                "photo",
                {"reply": form["reply_parameters"], "size": len(photo.file.read())},
                time.perf_counter(),
            )
        )  # type: ignore[union-attr]
        return web.json_response({"ok": True, "result": {"message_id": counter}})

    app = web.Application()
    app.router.add_post(f"/bot{TOKEN}/sendMessage", send_message)
    app.router.add_post(f"/bot{TOKEN}/sendPhoto", send_photo)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"  # type: ignore[union-attr]

    bars = _bars()
    engines = {KEY: IndicatorEngine(KEY, IndicatorConfig())}
    det = _detector(engines)
    # on chauffe jusqu'à la veille du dernier signal, puis on rejoue en « live »
    _, sigs = _collect_signals(bars)
    last_sig_ms = sigs[-1].payload.setup.time_ms
    cut = next(i for i, b in enumerate(bars) if b.close_time_ms == last_sig_ms)
    warm_up(engines, {KEY: bars[:cut]}, [det])
    try:
        async with TelegramClient(SecretStr(TOKEN), "1", base_url=url, http2=False) as tg:
            rec = LatencyRecorder()
            pipe = Pipeline(engines, [det], tg, rec)
            worker = ReportWorker(pipe.post_queue, tg, [])
            wtask = asyncio.create_task(worker.run())
            live_bar = bars[cut]
            from dataclasses import replace

            live_bar = replace(
                live_bar,
                recv_mono_ns=time.perf_counter_ns(),
                event_time_ms=time.time_ns() // 1_000_000,
            )
            pipe.process(live_bar)
            for _ in range(300):
                if worker.reports_sent:
                    break
                await asyncio.sleep(0.02)
            wtask.cancel()
    finally:
        await runner.cleanup()
    kinds = [c[0] for c in calls]
    assert kinds == ["message", "message", "photo"]
    alert, report, photo = calls
    assert "LONG BTCUSDT" in str(alert[1]["text"]) and "reply_parameters" not in alert[1]
    assert report[1]["reply_parameters"]["message_id"] == 1  # type: ignore[index]
    assert '"message_id": 2' in str(photo[1]["reply"])
    assert int(photo[1]["size"]) > 10_000  # type: ignore[call-overload]
    assert rec.samples and rec.samples[0].system_ms < 500
    assert math.isfinite(rec.samples[0].process_ms)
