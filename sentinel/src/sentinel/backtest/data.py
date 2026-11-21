"""Chargement des archives Parquet en objets `Bar` (et funding)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import polars as pl

from sentinel.core.models import Bar, Market, StreamKey, Timeframe

# Séries à couper : après ces dates, le symbole désigne un AUTRE actif ou une cotation
# reprise après faillite. Les relier fausserait totalement le test de survie.
DEATH_DATES = {
    "LUNAUSDT": "2022-05-13",  # effondrement ; le symbole est réutilisé par LUNA 2.0 le 31/05
    "FTTUSDT": "2022-11-15",  # faillite FTX ; cotation suspendue 311 jours puis reprise
}


def ms(date_str: str) -> int:
    return int(datetime.fromisoformat(date_str).replace(tzinfo=UTC).timestamp() * 1000)


def load_bars(root: Path, market: Market, symbol: str, tf: Timeframe) -> list[Bar]:
    df = pl.read_parquet(root / market.value / f"{symbol}_{tf.value}.parquet")
    if symbol in DEATH_DATES:
        df = df.filter(pl.col("open_time_ms") < ms(DEATH_DATES[symbol]))
    key = StreamKey(market, symbol, tf)
    return [
        Bar(key, r[0], r[1], r[2], r[3], r[4], r[5], r[6], True)
        for r in df.select(
            "open_time_ms", "close_time_ms", "open", "high", "low", "close", "volume"
        ).iter_rows()
    ]


def load_funding(root: Path, symbol: str) -> list[tuple[int, float]]:
    p = root / "funding" / f"{symbol}.parquet"
    if not p.exists():
        return []
    return [(int(t), float(r)) for t, r in pl.read_parquet(p).iter_rows()]
