from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
import pytest
from aiohttp import web
from pydantic import SecretStr

from sentinel.alerts.telegram import TelegramClient, TelegramError
from sentinel.core.config import BinanceEndpoints
from sentinel.core.models import Bar, Market, StreamKey, Timeframe
from sentinel.data.history import BinanceHistory, ParquetCache, is_contiguous, load_warmup

KEY = StreamKey(Market.SPOT, "BTCUSDT", Timeframe.H1)
TOKEN = "1234567890:AAFakeTokenForTestsOnly_abcdefghijklmn"


def _fake_binance(
    calls: list[dict[str, str]], limit_override: int | None = None
) -> httpx.MockTransport:
    """Simule /api/v3/klines : bougies 1h jusqu'à maintenant, la dernière encore ouverte."""

    def handler(req: httpx.Request) -> httpx.Response:
        q = dict(req.url.params)
        calls.append(q)
        tf = 3_600_000
        now = time.time_ns() // 1_000_000
        start = int(q["startTime"]) // tf * tf
        limit = limit_override or int(q["limit"])
        rows = []
        t = start
        while t <= min(int(q["endTime"]), now) and len(rows) < limit:
            rows.append([t, "1", "2", "0.5", "1.5", "10", t + tf - 1, "0", 0, "0", "0", "0"])
            t += tf
        return httpx.Response(200, json=rows)

    return httpx.MockTransport(handler)


async def test_fetch_range_paginates_and_excludes_open_bar() -> None:
    calls: list[dict[str, str]] = []
    async with httpx.AsyncClient(transport=_fake_binance(calls, limit_override=100)) as c:
        hist = BinanceHistory(BinanceEndpoints(), c)
        now = time.time_ns() // 1_000_000
        bars = await hist.fetch_range(KEY, now - 250 * 3_600_000)
    assert len(calls) >= 3  # pagination
    assert is_contiguous(bars)
    assert all(b.close_time_ms < now for b in bars)  # la bougie en cours est exclue
    assert 248 <= len(bars) <= 250


async def test_warmup_uses_cache_on_second_start(tmp_path: Path) -> None:
    calls: list[dict[str, str]] = []
    cache = ParquetCache(tmp_path)
    async with httpx.AsyncClient(transport=_fake_binance(calls)) as c:
        hist = BinanceHistory(BinanceEndpoints(), c)
        first = await load_warmup(KEY, 300, hist, cache)
        n_first = len(calls)
        second = await load_warmup(KEY, 300, hist, cache)
    assert len(first) == len(second) == 300
    assert is_contiguous(second)
    assert cache.path(KEY).exists()
    # 2e démarrage : au plus une petite requête pour la fin (0 si aucune nouvelle bougie
    # n'a clôturé entre-temps), au lieu de tout retélécharger.
    assert len(calls) - n_first <= 1
    assert [b.open_time_ms for b in first][-1] <= second[-1].open_time_ms


def test_parquet_roundtrip_dedup(tmp_path: Path) -> None:
    cache = ParquetCache(tmp_path)
    b = [Bar(KEY, i * 3_600_000, i * 3_600_000 + 1, 1, 2, 0.5, 1.5, 10, True) for i in range(5)]
    cache.save(KEY, b[:3])
    cache.save(KEY, b[2:])
    loaded = cache.load(KEY)
    assert [x.open_time_ms for x in loaded] == [x.open_time_ms for x in b]
    assert loaded[0] == b[0]


# --- Telegram ---------------------------------------------------------------------------
async def _start_server(app: web.Application) -> tuple[web.AppRunner, str]:
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
    return runner, f"http://127.0.0.1:{port}"


async def test_telegram_send_retry_429_and_reply() -> None:
    hits: list[dict[str, object]] = []

    async def send(req: web.Request) -> web.Response:
        body = await req.json()
        hits.append(body)
        if len(hits) == 1:
            return web.json_response(
                {"ok": False, "error_code": 429, "parameters": {"retry_after": 0.01}}, status=429
            )
        return web.json_response({"ok": True, "result": {"message_id": 42}})

    app = web.Application()
    app.router.add_post(f"/bot{TOKEN}/sendMessage", send)
    runner, url = await _start_server(app)
    try:
        async with TelegramClient(SecretStr(TOKEN), "777", base_url=url, http2=False) as tg:
            sent = await tg.send_message("hello", reply_to=41)
    finally:
        await runner.cleanup()
    assert sent.message_id == 42 and len(hits) == 2
    assert hits[1]["reply_parameters"] == {"message_id": 41, "allow_sending_without_reply": True}
    assert hits[1]["chat_id"] == "777"


async def test_telegram_error_does_not_leak_token() -> None:
    async with TelegramClient(
        SecretStr(TOKEN), "1", base_url="http://127.0.0.1:9", max_retries=0, http2=False
    ) as tg:
        with pytest.raises(TelegramError) as exc:
            await tg.send_message("x")
    assert TOKEN not in str(exc.value)


async def test_telegram_api_error_raises() -> None:
    async def send(_req: web.Request) -> web.Response:
        return web.json_response({"ok": False, "description": "chat not found"}, status=400)

    app = web.Application()
    app.router.add_post(f"/bot{TOKEN}/sendMessage", send)
    runner, url = await _start_server(app)
    try:
        async with TelegramClient(SecretStr(TOKEN), "1", base_url=url, http2=False) as tg:
            with pytest.raises(TelegramError, match="chat not found"):
                await tg.send_message("x")
    finally:
        await runner.cleanup()
    assert json.dumps({"a": 1})  # garde l'import json utilisé
