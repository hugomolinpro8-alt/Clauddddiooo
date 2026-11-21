"""Flux WebSocket Binance (spot et perpétuels USDT-M), lecture publique uniquement.

Un seul WebSocket « combined stream » par marché transporte toutes les paires et unités
de temps (`btcusdt@kline_15m/ethusdt@kline_1h/...`). On reçoit directement les bougies
officielles de Binance pour chaque unité de temps : pas besoin de reconstruire le 4h à
partir du 1m (source d'erreurs d'alignement). Binance pousse une mise à jour de la bougie
en cours ~1×/s (spot) ou ~4×/s (perp) et un message final `x=true` à la clôture.

Robustesse :
  - ping/pong WebSocket (websockets gère le heartbeat protocolaire) ;
  - reconnexion avec backoff exponentiel + jitter (évite de marteler le serveur) ;
  - Binance coupe chaque connexion au bout de 24 h : simple reconnexion ;
  - un message illisible est journalisé et ignoré, il ne tue pas le flux.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import random
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidURI

from sentinel.core.config import FeedConfig
from sentinel.core.logging import get_logger
from sentinel.core.models import Bar, Market, StreamKey, Timeframe

log = get_logger(__name__)

_TF_BY_BINANCE = {tf.value: tf for tf in Timeframe}


class FeedState(StrEnum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"


@dataclass(frozen=True, slots=True)
class FeedStatus:
    feed: str
    state: FeedState
    detail: str = ""


def stream_names(symbols: Sequence[str], timeframes: Sequence[Timeframe]) -> list[str]:
    return [f"{s.lower()}@kline_{tf.value}" for s in symbols for tf in timeframes]


def parse_kline_message(
    raw: str | bytes, market: Market, recv_wall_ms: int, recv_mono_ns: int
) -> Bar | None:
    """Transforme un message brut en `Bar`. Renvoie None si ce n'est pas une bougie."""
    msg: Any = json.loads(raw)
    data = msg.get("data", msg) if isinstance(msg, dict) else None
    if not isinstance(data, dict) or data.get("e") != "kline":
        return None
    k = data["k"]
    tf = _TF_BY_BINANCE.get(k["i"])
    if tf is None:
        return None
    return Bar(
        key=StreamKey(market, str(k["s"]).upper(), tf),
        open_time_ms=int(k["t"]),
        close_time_ms=int(k["T"]),
        open=float(k["o"]),
        high=float(k["h"]),
        low=float(k["l"]),
        close=float(k["c"]),
        volume=float(k["v"]),
        closed=bool(k["x"]),
        event_time_ms=int(data["E"]),
        recv_wall_ms=recv_wall_ms,
        recv_mono_ns=recv_mono_ns,
    )


class BinanceKlineFeed:
    def __init__(
        self,
        market: Market,
        symbols: Sequence[str],
        timeframes: Sequence[Timeframe],
        ws_base: str,
        cfg: FeedConfig,
        on_status: Callable[[FeedStatus], None] | None = None,
    ) -> None:
        self.market = market
        self.name = f"binance-{market}"
        self.url = f"{ws_base.rstrip('/')}/stream?streams=" + "/".join(
            stream_names(symbols, timeframes)
        )
        self.cfg = cfg
        self._on_status = on_status or (lambda _s: None)
        self._stop = asyncio.Event()
        self.reconnects = 0

    def stop(self) -> None:
        self._stop.set()

    async def run(self, sink: Callable[[Bar], None]) -> None:
        """Boucle infinie : connexion, lecture, reconnexion. `sink` doit être non bloquant."""
        backoff = self.cfg.reconnect_min_backoff_s
        while not self._stop.is_set():
            connected_at: float | None = None
            try:
                async with websockets.connect(
                    self.url,
                    ping_interval=self.cfg.ping_interval_s,
                    ping_timeout=self.cfg.ping_interval_s,
                    open_timeout=10,
                    close_timeout=2,
                    max_size=2**20,
                ) as ws:
                    connected_at = time.monotonic()
                    log.info("feed_connected", feed=self.name)
                    self._on_status(FeedStatus(self.name, FeedState.CONNECTED))
                    async for raw in ws:
                        recv_mono = time.perf_counter_ns()
                        recv_wall = time.time_ns() // 1_000_000
                        try:
                            bar = parse_kline_message(raw, self.market, recv_wall, recv_mono)
                        except (ValueError, KeyError, TypeError) as e:
                            log.warning("feed_bad_message", feed=self.name, error=repr(e))
                            continue
                        if bar is not None:
                            sink(bar)
                        if self._stop.is_set():
                            break
            except asyncio.CancelledError:
                raise
            except (OSError, ConnectionClosed, InvalidHandshake, InvalidURI, TimeoutError) as e:
                log.warning("feed_disconnected", feed=self.name, error=repr(e))
                self._on_status(FeedStatus(self.name, FeedState.DISCONNECTED, repr(e)))
            else:
                if not self._stop.is_set():
                    self._on_status(FeedStatus(self.name, FeedState.DISCONNECTED, "closed"))
            if self._stop.is_set():
                break
            # Connexion restée stable plus d'une minute → on repart du backoff minimal.
            if connected_at is not None and time.monotonic() - connected_at > 60:
                backoff = self.cfg.reconnect_min_backoff_s
            delay = backoff * (1 + random.random() * 0.3)
            self.reconnects += 1
            log.info("feed_reconnecting", feed=self.name, delay_s=round(delay, 2))
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            backoff = min(backoff * 2, self.cfg.reconnect_max_backoff_s)
