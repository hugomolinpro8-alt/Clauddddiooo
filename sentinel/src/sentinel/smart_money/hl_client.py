"""Client de l'API publique Hyperliquid (lecture seule, aucune clé, aucun ordre).

Endpoints utilisés (POST https://api.hyperliquid.xyz/info) :
  - clearinghouseState : positions perp ouvertes (taille, entrée, levier, liquidation)
  - portfolio          : historique échantillonné de la valeur du compte et du PnL cumulé
  - userFillsByTime    : exécutions (≤ 2000 par appel ; seules les 10 000 plus récentes
                         sont accessibles — limite de l'API, signalée dans les rapports)
  - candleSnapshot     : bougies (≤ 5000 par appel), pour simuler un délai de copie
Classement : GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard (non documenté).

Le quota de l'API est pondéré (~1200 unités/min) : on limite à quelques requêtes par seconde
et on met les bougies en cache par actif (partagées entre portefeuilles).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from sentinel.core.logging import get_logger

log = get_logger(__name__)

INFO_URL = "https://api.hyperliquid.xyz/info"
LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
MIN_INTERVAL_S = 0.25  # ≤ 4 requêtes/s


class HyperliquidClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        info_url: str = INFO_URL,
        leaderboard_url: str = LEADERBOARD_URL,
    ) -> None:
        self.client = client
        self.info_url = info_url
        self.leaderboard_url = leaderboard_url
        self._lock = asyncio.Lock()
        self._last = 0.0
        self._candles: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.requests = 0

    async def _throttle(self) -> None:
        async with self._lock:
            wait = self._last + MIN_INTERVAL_S - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = time.monotonic()

    async def info(self, payload: dict[str, Any]) -> Any:
        for attempt in range(5):
            await self._throttle()
            self.requests += 1
            try:
                r = await self.client.post(self.info_url, json=payload, timeout=30)
            except httpx.HTTPError as e:
                log.warning("hl_request_failed", type=payload.get("type"), error=repr(e))
                await asyncio.sleep(1.0 * 2**attempt)
                continue
            if r.status_code == 429:
                await asyncio.sleep(2.0 * 2**attempt)
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError(f"Hyperliquid indisponible ({payload.get('type')})")

    async def leaderboard(self) -> list[dict[str, Any]]:
        r = await self.client.get(self.leaderboard_url, timeout=120)
        r.raise_for_status()
        rows: list[dict[str, Any]] = r.json()["leaderboardRows"]
        return rows

    async def clearinghouse(self, user: str) -> dict[str, Any]:
        out: dict[str, Any] = await self.info({"type": "clearinghouseState", "user": user})
        return out

    async def portfolio(self, user: str) -> dict[str, Any]:
        raw = await self.info({"type": "portfolio", "user": user})
        return dict(raw) if raw else {}

    async def fills_by_time(self, user: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        """Exécutions entre start et end, paginées par 2000 (ordre chronologique)."""
        out: list[dict[str, Any]] = []
        cursor = start_ms
        while cursor < end_ms:
            page = await self.info(
                {
                    "type": "userFillsByTime",
                    "user": user,
                    "startTime": cursor,
                    "endTime": end_ms,
                    "aggregateByTime": True,
                }
            )
            if not page:
                break
            out.extend(page)
            last = max(int(f["time"]) for f in page)
            if len(page) < 2000 or last <= cursor:
                break
            cursor = last + 1
        seen: set[tuple[Any, ...]] = set()
        uniq = []
        for f in sorted(out, key=lambda f: int(f["time"])):
            k = (f.get("tid"), f.get("hash"), f["time"], f["coin"], f["sz"])
            if k not in seen:
                seen.add(k)
                uniq.append(f)
        return uniq

    async def candles(
        self, coin: str, interval: str, start_ms: int, end_ms: int
    ) -> list[dict[str, Any]]:
        """Bougies (cache par actif/intervalle : partagé entre tous les portefeuilles)."""
        key = (coin, interval)
        cached = self._candles.get(key, [])
        if cached and cached[0]["t"] <= start_ms and cached[-1]["t"] >= end_ms - 120_000:
            return cached
        step = {"1m": 60_000, "5m": 300_000, "1h": 3_600_000}[interval]
        out: list[dict[str, Any]] = []
        cursor = start_ms
        while cursor < end_ms:
            chunk_end = min(end_ms, cursor + 4999 * step)
            page = await self.info(
                {
                    "type": "candleSnapshot",
                    "req": {
                        "coin": coin,
                        "interval": interval,
                        "startTime": cursor,
                        "endTime": chunk_end,
                    },
                }
            )
            if page:
                out.extend(page)
            cursor = chunk_end + step
        out = sorted({c["t"]: c for c in out}.values(), key=lambda c: c["t"])
        self._candles[key] = out
        return out
