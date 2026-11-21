from __future__ import annotations

import asyncio
import json
import logging

import pytest
import websockets

from sentinel.core.config import FeedConfig, Secrets
from sentinel.core.logging import MASK, configure_logging, get_logger, register_secret
from sentinel.core.models import Bar, Market, Timeframe
from sentinel.data.feeds.binance import (
    BinanceKlineFeed,
    FeedState,
    FeedStatus,
    parse_kline_message,
    stream_names,
)
from sentinel.data.watchdog import FeedWatchdog, WatchdogEvent
from tests.helpers import kline_msg, random_bars

FAKE_TOKEN = "1234567890:AAFakeTokenForTestsOnly_abcdefghijklmn"


# --- parsing --------------------------------------------------------------------------
def test_parse_combined_and_raw_kline() -> None:
    bar = random_bars(1)[0]
    for prefixed in (True, False):
        parsed = parse_kline_message(kline_msg(bar, 123, prefixed), Market.PERP, 1, 2)
        assert parsed is not None
        assert parsed.key.market is Market.PERP and parsed.symbol == "BTCUSDT"
        assert parsed.timeframe is Timeframe.M15 and parsed.closed
        assert parsed.event_time_ms == 123 and parsed.recv_mono_ns == 2
        assert parsed.close == pytest.approx(round(bar.close, 2))


def test_parse_ignores_non_kline() -> None:
    assert parse_kline_message(json.dumps({"result": None, "id": 1}), Market.SPOT, 0, 0) is None
    assert parse_kline_message(json.dumps({"data": {"e": "aggTrade"}}), Market.SPOT, 0, 0) is None


def test_stream_names() -> None:
    assert stream_names(["BTCUSDT"], [Timeframe.H4]) == ["btcusdt@kline_4h"]


# --- reconnexion ---------------------------------------------------------------------
async def test_feed_reconnects_after_server_drops() -> None:
    """Le serveur coupe la connexion après 2 messages, 3 fois : le flux se reconnecte
    seul et ne perd aucun message ; les messages illisibles sont ignorés."""
    bars = random_bars(6)
    connections = 0

    async def handler(ws: websockets.ServerConnection) -> None:
        nonlocal connections
        i = connections
        connections += 1
        if i >= 3:
            await asyncio.sleep(10)
            return
        await ws.send("{not json")
        for b in bars[2 * i : 2 * i + 2]:
            await ws.send(kline_msg(b, 1))
        await ws.close()

    received: list[Bar] = []
    statuses: list[FeedStatus] = []
    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        cfg = FeedConfig(reconnect_min_backoff_s=0.01, reconnect_max_backoff_s=0.05)
        feed = BinanceKlineFeed(
            Market.SPOT,
            ["BTCUSDT"],
            [Timeframe.M15],
            f"ws://127.0.0.1:{port}",
            cfg,
            statuses.append,
        )
        task = asyncio.create_task(feed.run(received.append))
        for _ in range(200):
            if len(received) == 6:
                break
            await asyncio.sleep(0.01)
        feed.stop()
        await asyncio.wait_for(task, 2)
    assert [b.open_time_ms for b in received] == [b.open_time_ms for b in bars]
    assert feed.reconnects >= 3
    assert sum(s.state is FeedState.DISCONNECTED for s in statuses) >= 3


# --- watchdog --------------------------------------------------------------------------
async def test_watchdog_fires_once_then_recovers() -> None:
    now = [0.0]
    events: list[WatchdogEvent] = []

    async def on_event(ev: WatchdogEvent) -> None:
        events.append(ev)

    wd = FeedWatchdog(60, on_event, clock=lambda: now[0])
    wd.register("spot:BTCUSDT")
    now[0] = 30
    assert wd.check() == []
    now[0] = 61
    evs = wd.check()
    assert len(evs) == 1 and evs[0].stale
    now[0] = 120
    assert wd.check() == []  # pas de spam : une seule alerte par coupure
    wd.touch("spot:BTCUSDT")
    evs = wd.check()
    assert len(evs) == 1 and not evs[0].stale
    assert evs[0].silent_for_s == pytest.approx(120)
    assert wd.stale == set()


# --- secrets ---------------------------------------------------------------------------
def test_token_never_appears_in_logs(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    register_secret(FAKE_TOKEN)
    log = get_logger("test")
    log.info("event", url=f"https://api.telegram.org/bot{FAKE_TOKEN}/sendMessage")
    log.info("event2", telegram_bot_token="whatever")
    logging.getLogger("other").warning("POST https://api.telegram.org/bot%s/x", FAKE_TOKEN)
    out = capsys.readouterr().out
    assert FAKE_TOKEN not in out
    assert out.count(MASK) >= 3


def test_unknown_token_pattern_is_masked_too(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    other = "9876543210:ZZanotherTokenNeverRegistered_0123456"
    get_logger("t").info("x", detail=f"err /bot{other}/getMe")
    assert other not in capsys.readouterr().out


def test_secrets_repr_hides_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", FAKE_TOKEN)
    s = Secrets(_env_file=None)  # type: ignore[call-arg]
    assert FAKE_TOKEN not in repr(s) and FAKE_TOKEN not in str(s)
    assert s.telegram_bot_token is not None
    assert s.telegram_bot_token.get_secret_value() == FAKE_TOKEN
