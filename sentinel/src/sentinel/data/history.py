"""Historique REST Binance + cache Parquet.

Au démarrage, les indicateurs ont besoin de centaines de bougies passées (une EMA 200
n'a de sens qu'après ≥ 200 bougies). On les charge en REST, on les met en cache sur
disque (Parquet, format colonne compressé), et au démarrage suivant on ne télécharge
que ce qui manque. Le REST n'est JAMAIS appelé sur le chemin critique d'une alerte —
seulement au démarrage et pour combler un trou après une coupure.
"""

from __future__ import annotations

import itertools
import time
from pathlib import Path

import httpx
import polars as pl

from sentinel.core.config import BinanceEndpoints
from sentinel.core.logging import get_logger
from sentinel.core.models import Bar, Market, StreamKey

log = get_logger(__name__)

_SCHEMA = {
    "open_time_ms": pl.Int64,
    "close_time_ms": pl.Int64,
    "open": pl.Float64,
    "high": pl.Float64,
    "low": pl.Float64,
    "close": pl.Float64,
    "volume": pl.Float64,
}


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


class BinanceHistory:
    def __init__(self, endpoints: BinanceEndpoints, client: httpx.AsyncClient) -> None:
        self.endpoints = endpoints
        self.client = client

    def _klines_url(self, market: Market) -> tuple[str, int]:
        base = self.endpoints.rest(market).rstrip("/")
        if market is Market.SPOT:
            return f"{base}/api/v3/klines", 1000
        return f"{base}/fapi/v1/klines", 1500

    async def server_time_ms(self, market: Market = Market.SPOT) -> int:
        base = self.endpoints.rest(market).rstrip("/")
        path = "/api/v3/time" if market is Market.SPOT else "/fapi/v1/time"
        r = await self.client.get(base + path)
        r.raise_for_status()
        return int(r.json()["serverTime"])

    async def estimate_clock_skew(
        self, market: Market = Market.SPOT, samples: int = 7
    ) -> tuple[float, float]:
        """Décalage (horloge locale − serveur) en ms, façon NTP : on garde l'échantillon au
        plus petit aller-retour, car l'incertitude sur le décalage vaut ± RTT/2.
        Renvoie (décalage, incertitude)."""
        best: tuple[float, float] | None = None
        for _ in range(samples):
            t0 = time.time_ns() / 1e6
            server = await self.server_time_ms(market)
            t1 = time.time_ns() / 1e6
            rtt = t1 - t0
            if best is None or rtt / 2 < best[1]:
                best = ((t0 + t1) / 2 - server, rtt / 2)
        assert best is not None
        return best

    async def fetch_range(
        self, key: StreamKey, start_ms: int, end_ms: int | None = None
    ) -> list[Bar]:
        """Bougies CLÔTURÉES dont open_time ∈ [start_ms, end_ms], paginées."""
        url, limit = self._klines_url(key.market)
        now = _now_ms()
        end_ms = now if end_ms is None else end_ms
        out: list[Bar] = []
        tf = key.timeframe.ms
        cursor = start_ms
        # On s'arrête sur un critère TEMPOREL (plus de bougie clôturée à demander), pas sur
        # « page incomplète » : si l'exchange plafonne ses pages sous notre `limit`, ce
        # dernier critère tronquerait l'historique en silence.
        while cursor <= end_ms and cursor + tf - 1 < now:
            params: dict[str, str | int] = {
                "symbol": key.symbol,
                "interval": key.timeframe.value,
                "startTime": cursor,
                "endTime": end_ms,
                "limit": limit,
            }
            r = await self.client.get(url, params=params)
            r.raise_for_status()
            rows = r.json()
            if not rows:
                break
            for row in rows:
                close_time = int(row[6])
                if close_time >= now:  # bougie encore ouverte : on l'exclut
                    continue
                out.append(
                    Bar(
                        key=key,
                        open_time_ms=int(row[0]),
                        close_time_ms=close_time,
                        open=float(row[1]),
                        high=float(row[2]),
                        low=float(row[3]),
                        close=float(row[4]),
                        volume=float(row[5]),
                        closed=True,
                    )
                )
            cursor = int(rows[-1][0]) + tf
        return out


class ParquetCache:
    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, key: StreamKey) -> Path:
        return self.root / key.market.value / f"{key.symbol}_{key.timeframe.value}.parquet"

    def load(self, key: StreamKey) -> list[Bar]:
        p = self.path(key)
        if not p.exists():
            return []
        df = pl.read_parquet(p)
        return [Bar(key=key, closed=True, **row) for row in df.iter_rows(named=True)]

    def save(self, key: StreamKey, bars: list[Bar]) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        df = pl.DataFrame(
            {
                "open_time_ms": [b.open_time_ms for b in bars],
                "close_time_ms": [b.close_time_ms for b in bars],
                "open": [b.open for b in bars],
                "high": [b.high for b in bars],
                "low": [b.low for b in bars],
                "close": [b.close for b in bars],
                "volume": [b.volume for b in bars],
            },
            schema=_SCHEMA,
        )
        if p.exists():
            df = pl.concat([pl.read_parquet(p), df])
        df = df.unique("open_time_ms", keep="last").sort("open_time_ms")
        tmp = p.with_suffix(".tmp")
        df.write_parquet(tmp)
        tmp.replace(p)  # écriture atomique : pas de fichier corrompu si on coupe au milieu


def is_contiguous(bars: list[Bar]) -> bool:
    return all(
        b.open_time_ms - a.open_time_ms == a.key.timeframe.ms for a, b in itertools.pairwise(bars)
    )


async def load_warmup(
    key: StreamKey, n: int, history: BinanceHistory, cache: ParquetCache
) -> list[Bar]:
    """Renvoie les `n` dernières bougies clôturées, contiguës, en complétant le cache."""
    tf = key.timeframe.ms
    now = _now_ms()
    want_start = (now // tf - n - 1) * tf
    cached = [b for b in cache.load(key) if b.open_time_ms >= want_start]
    if cached and is_contiguous(cached) and cached[0].open_time_ms <= want_start + tf:
        start = cached[-1].open_time_ms + tf
    else:
        cached, start = [], want_start
    fresh = await history.fetch_range(key, start) if start < now else []
    if fresh:
        cache.save(key, fresh)
    bars = (cached + fresh)[-n:]
    if not is_contiguous(bars):
        log.warning("warmup_not_contiguous_refetch", stream=str(key))
        bars = (await history.fetch_range(key, want_start))[-n:]
        cache.save(key, bars)
    log.info("warmup_loaded", stream=str(key), bars=len(bars), from_cache=len(cached))
    return bars
