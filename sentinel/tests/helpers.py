from __future__ import annotations

import json

import numpy as np

from sentinel.core.models import Bar, Market, StreamKey, Timeframe

KEY = StreamKey(Market.SPOT, "BTCUSDT", Timeframe.M15)


def random_bars(
    n: int,
    key: StreamKey = KEY,
    seed: int = 0,
    start_price: float = 60_000.0,
    start_ms: int = 1_700_000_000_000 // 900_000 * 900_000,
) -> list[Bar]:
    """Marche aléatoire géométrique réaliste (vol ~0,4 %/bougie) avec OHLCV cohérents."""
    rng = np.random.default_rng(seed)
    tf = key.timeframe.ms
    bars: list[Bar] = []
    price = start_price
    for i in range(n):
        o = price
        c = o * float(np.exp(rng.normal(0, 0.004)))
        h = max(o, c) * (1 + abs(float(rng.normal(0, 0.002))))
        lo = min(o, c) * (1 - abs(float(rng.normal(0, 0.002))))
        v = float(rng.lognormal(3, 0.5))
        t = start_ms + i * tf
        bars.append(Bar(key, t, t + tf - 1, o, h, lo, c, v, True))
        price = c
    return bars


def kline_msg(bar: Bar, event_time_ms: int, stream_prefix: bool = True) -> str:
    data = {
        "e": "kline",
        "E": event_time_ms,
        "s": bar.symbol,
        "k": {
            "t": bar.open_time_ms,
            "T": bar.close_time_ms,
            "s": bar.symbol,
            "i": bar.timeframe.value,
            "o": f"{bar.open:.2f}",
            "c": f"{bar.close:.2f}",
            "h": f"{bar.high:.2f}",
            "l": f"{bar.low:.2f}",
            "v": f"{bar.volume:.4f}",
            "x": bar.closed,
        },
    }
    if stream_prefix:
        return json.dumps(
            {"stream": f"{bar.symbol.lower()}@kline_{bar.timeframe.value}", "data": data}
        )
    return json.dumps(data)
