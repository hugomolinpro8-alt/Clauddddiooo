"""TEST DE LATENCE de bout en bout : « événement de marché → message Telegram envoyé ».

Montage réaliste mais local (pour être reproductible et indépendant d'Internet) :
  faux serveur WebSocket Binance ──ws──► BinanceKlineFeed ─► Pipeline ─► indicateurs
  ─► ProbeDetector ─► TelegramClient ──HTTP──► faux serveur Telegram (aiohttp).

Toute la pile réelle est exercée : vraie connexion WebSocket, vrai parsing JSON, vrai
client HTTP persistant, vraie sérialisation. Seuls les serveurs distants sont simulés.
Le réseau réel (Binance → toi, toi → Telegram) s'ajoute en production ; il est mesuré
séparément par `scripts/live_probe.py`.
"""

from __future__ import annotations

import asyncio
import time

import websockets
from aiohttp import web
from pydantic import SecretStr

from sentinel.alerts.telegram import TelegramClient
from sentinel.core.config import FeedConfig, IndicatorConfig
from sentinel.core.models import Market, Timeframe
from sentinel.data.feeds.binance import BinanceKlineFeed
from sentinel.indicators.engine import IndicatorEngine
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import Pipeline, ProbeDetector
from tests.helpers import KEY, kline_msg, random_bars

TOKEN = "1234567890:AAFakeTokenForTestsOnly_abcdefghijklmn"
TARGET_MS = 500.0


async def _telegram_server(delay_s: float) -> tuple[web.AppRunner, str, list[float]]:
    received_at: list[float] = []
    counter = 0

    async def send(req: web.Request) -> web.Response:
        nonlocal counter
        await req.json()
        if delay_s:
            await asyncio.sleep(delay_s)  # simule l'aller-retour réseau vers Telegram
        counter += 1
        received_at.append(time.perf_counter())
        return web.json_response({"ok": True, "result": {"message_id": counter}})

    async def get_me(_req: web.Request) -> web.Response:
        return web.json_response({"ok": True, "result": {"username": "test_bot"}})

    app = web.Application()
    app.router.add_post(f"/bot{TOKEN}/sendMessage", send)
    app.router.add_post(f"/bot{TOKEN}/getMe", get_me)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
    return runner, f"http://127.0.0.1:{port}", received_at


async def _run_e2e(n_alerts: int, tg_delay_s: float, interval_s: float) -> LatencyRecorder:
    warm = random_bars(300 + n_alerts, seed=1)
    warmup, live = warm[:300], warm[300:]

    engine = IndicatorEngine(KEY, IndicatorConfig())
    for b in warmup:
        engine.update(b)
    assert engine.last is not None and engine.last.ready

    async def ws_handler(ws: websockets.ServerConnection) -> None:
        for b in live:
            # Mise à jour intrabar (ignorée en mode close) puis clôture.
            await ws.send(
                kline_msg(
                    type(b)(
                        b.key,
                        b.open_time_ms,
                        b.close_time_ms,
                        b.open,
                        b.high,
                        b.low,
                        b.close,
                        b.volume,
                        False,
                    ),
                    time.time_ns() // 1_000_000,
                )
            )
            await ws.send(kline_msg(b, time.time_ns() // 1_000_000))
            await asyncio.sleep(interval_s)
        await ws.wait_closed()

    runner, tg_url, tg_received = await _telegram_server(tg_delay_s)
    recorder = LatencyRecorder(TARGET_MS)
    try:
        async with (
            websockets.serve(ws_handler, "127.0.0.1", 0) as server,
            TelegramClient(SecretStr(TOKEN), "1", base_url=tg_url, http2=False) as tg,
        ):
            await tg.warmup()  # connexion ouverte AVANT les alertes, comme en production
            port = server.sockets[0].getsockname()[1]
            pipe = Pipeline({KEY: engine}, [ProbeDetector()], tg, recorder)
            feed = BinanceKlineFeed(
                Market.SPOT, ["BTCUSDT"], [Timeframe.M15], f"ws://127.0.0.1:{port}", FeedConfig()
            )
            tasks = [asyncio.create_task(pipe.run()), asyncio.create_task(feed.run(pipe.sink))]
            deadline = time.monotonic() + 30
            while len(recorder.samples) < n_alerts and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            feed.stop()
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        await runner.cleanup()
    assert len(tg_received) == n_alerts, "toutes les alertes doivent arriver à Telegram"
    assert pipe.send_failures == 0
    return recorder


def _report(title: str, rec: LatencyRecorder) -> dict[str, float]:
    s = rec.summary()
    print(f"\n=== {title} (n={int(s['n'])}) ===")
    for k in ("process_ms", "system_ms"):
        print(
            f"  {k:<11} p50={s[k + '_p50']:.3f}  p95={s[k + '_p95']:.3f}  "
            f"p99={s[k + '_p99']:.3f}  max={s[k + '_max']:.3f}"
        )
    return s


async def test_latency_end_to_end_local() -> None:
    """300 alertes, une toutes les 20 ms. Objectif système : p99 < 500 ms."""
    s = _report("E2E local, Telegram instantané", await _run_e2e(300, 0.0, 0.02))
    assert s["system_ms_p99"] < TARGET_MS
    assert s["process_ms_p99"] < 10.0  # notre code pur : réception → avant envoi HTTP


async def test_slow_telegram_does_not_block_processing() -> None:
    """Telegram répond en 250 ms et les alertes arrivent toutes les 20 ms (rafale).
    Si l'envoi bloquait le pipeline, la latence s'accumulerait (n × 250 ms).
    Grâce aux tâches concurrentes, chaque alerte reste ≈ 250 ms."""
    s = _report("E2E local, Telegram lent (250 ms), rafale", await _run_e2e(60, 0.25, 0.02))
    assert s["system_ms_p99"] < TARGET_MS
    assert s["process_ms_p99"] < 10.0
