"""Télécharge l'historique nécessaire au backtest de la phase 2.

    uv run python scripts/download_archives.py

Inclut volontairement des actifs MORTS (LUNA, FTT) pour mesurer le biais de survie :
une stratégie testée uniquement sur les gagnants d'aujourd'hui paraît meilleure qu'elle
ne l'est.
"""

from __future__ import annotations

import asyncio
from datetime import date
from pathlib import Path

import httpx

from sentinel.core.logging import configure_logging
from sentinel.core.models import Market, Timeframe
from sentinel.data.archive import download_funding, download_klines

OUT = Path("data/archive")
START = date(2019, 1, 1)
ALIVE = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
DEAD = ["LUNAUSDT", "FTTUSDT"]  # LUNA : −99,9 % en mai 2022 ; FTT : faillite FTX nov. 2022


async def main() -> None:
    configure_logging("INFO")
    async with httpx.AsyncClient(timeout=60, http2=True) as c:
        jobs = []
        for sym in ALIVE + DEAD:
            for tf in (Timeframe.H4, Timeframe.D1):
                jobs.append(download_klines(c, Market.SPOT, sym, tf, START, OUT))
        for sym in ALIVE:
            for tf in (Timeframe.H4, Timeframe.D1):
                jobs.append(download_klines(c, Market.PERP, sym, tf, START, OUT))
            jobs.append(download_funding(c, sym, START, OUT))
        await asyncio.gather(*jobs)


if __name__ == "__main__":
    asyncio.run(main())
