"""Téléchargement des archives publiques Binance (data.binance.vision) vers Parquet.

Pourquoi les archives plutôt que l'API REST : 7 ans de bougies 4h × plusieurs actifs
= des centaines de requêtes REST paginées, soumises à quota. Les archives sont des ZIP
mensuels statiques, servis par CDN, gratuits, et contiennent aussi l'historique du
funding des perpétuels (indispensable pour un backtest perp honnête).

Pièges de format gérés (et testés) :
  - depuis 2025, les horodatages spot sont en MICROsecondes (16 chiffres) au lieu de ms ;
  - certains fichiers ont une ligne d'en-tête, d'autres non ;
  - le mois en cours n'existe qu'en fichiers journaliers.
"""

from __future__ import annotations

import asyncio
import csv
import io
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import polars as pl

from sentinel.core.logging import get_logger
from sentinel.core.models import Market, Timeframe

log = get_logger(__name__)

BASE = "https://data.binance.vision/data"
_US_THRESHOLD = 10**14  # au-delà : microsecondes (1e14 ms ≈ an 5138)


def _ms(ts: str) -> int:
    v = int(ts)
    return v // 1000 if v > _US_THRESHOLD else v


def parse_kline_csv(text: str) -> list[tuple[int, int, float, float, float, float, float]]:
    rows = []
    for rec in csv.reader(io.StringIO(text)):
        if not rec or not rec[0].strip().isdigit():
            continue  # en-tête ou ligne vide
        rows.append(
            (
                _ms(rec[0]),
                _ms(rec[6]),
                float(rec[1]),
                float(rec[2]),
                float(rec[3]),
                float(rec[4]),
                float(rec[5]),
            )
        )
    return rows


def parse_funding_csv(text: str) -> list[tuple[int, float]]:
    rows = []
    for rec in csv.reader(io.StringIO(text)):
        if not rec or not rec[0].strip().isdigit():
            continue
        rows.append((_ms(rec[0]), float(rec[-1])))
    return rows


def _months(start: date, end: date) -> list[date]:
    out, d = [], date(start.year, start.month, 1)
    while d <= end:
        out.append(d)
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return out


def _prefix(market: Market) -> str:
    return "spot" if market is Market.SPOT else "futures/um"


def kline_urls(market: Market, symbol: str, tf: Timeframe, start: date, today: date) -> list[str]:
    first_of_month = date(today.year, today.month, 1)
    last_full = first_of_month - timedelta(days=1)
    p = f"{BASE}/{_prefix(market)}"
    urls = [
        f"{p}/monthly/klines/{symbol}/{tf.value}/{symbol}-{tf.value}-{m:%Y-%m}.zip"
        for m in _months(start, last_full)
    ]
    d = first_of_month
    while d < today:
        urls.append(f"{p}/daily/klines/{symbol}/{tf.value}/{symbol}-{tf.value}-{d:%Y-%m-%d}.zip")
        d += timedelta(days=1)
    return urls


def funding_urls(symbol: str, start: date, today: date) -> list[str]:
    last_full = date(today.year, today.month, 1) - timedelta(days=1)
    return [
        f"{BASE}/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{m:%Y-%m}.zip"
        for m in _months(start, last_full)
    ]


async def _fetch_zip_text(
    client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore
) -> str | None:
    async with sem:
        for attempt in range(4):
            try:
                r = await client.get(url)
            except httpx.HTTPError:
                await asyncio.sleep(0.5 * 2**attempt)
                continue
            if r.status_code == 404:
                return None  # actif pas encore listé / déjà délisté ce mois-là
            if r.status_code >= 500 or r.status_code == 429:
                await asyncio.sleep(0.5 * 2**attempt)
                continue
            r.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                return z.read(z.namelist()[0]).decode()
        raise RuntimeError(f"échec téléchargement {url}")


async def download_klines(
    client: httpx.AsyncClient,
    market: Market,
    symbol: str,
    tf: Timeframe,
    start: date,
    out_dir: Path,
    today: date | None = None,
    concurrency: int = 8,
) -> pl.DataFrame:
    today = today or datetime.now(UTC).date()
    sem = asyncio.Semaphore(concurrency)
    urls = kline_urls(market, symbol, tf, start, today)
    texts = await asyncio.gather(*(_fetch_zip_text(client, u, sem) for u in urls))
    rows = [r for t in texts if t for r in parse_kline_csv(t)]
    df = (
        pl.DataFrame(
            rows,
            schema=["open_time_ms", "close_time_ms", "open", "high", "low", "close", "volume"],
            orient="row",
        )
        .unique("open_time_ms")
        .sort("open_time_ms")
    )
    path = out_dir / market.value / f"{symbol}_{tf.value}.parquet"
    path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(path)
    log.info(
        "archive_klines",
        market=str(market),
        symbol=symbol,
        tf=tf.value,
        rows=df.height,
        files=sum(t is not None for t in texts),
    )
    return df


async def download_funding(
    client: httpx.AsyncClient, symbol: str, start: date, out_dir: Path, today: date | None = None
) -> pl.DataFrame:
    today = today or datetime.now(UTC).date()
    sem = asyncio.Semaphore(8)
    texts = await asyncio.gather(
        *(_fetch_zip_text(client, u, sem) for u in funding_urls(symbol, start, today))
    )
    rows = [r for t in texts if t for r in parse_funding_csv(t)]
    df = (
        pl.DataFrame(rows, schema=["time_ms", "rate"], orient="row")
        .unique("time_ms")
        .sort("time_ms")
    )
    path = out_dir / "funding" / f"{symbol}.parquet"
    path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(path)
    log.info("archive_funding", symbol=symbol, rows=df.height)
    return df
