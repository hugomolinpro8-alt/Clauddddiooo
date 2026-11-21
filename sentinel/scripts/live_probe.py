"""Mesure de latence en conditions RÉELLES (réseau Binance + Telegram si configuré).

    uv run python scripts/live_probe.py --config config/config.yaml --seconds 60

Mesure, pour chaque message WebSocket reçu :
  - network_ms : horodatage Binance (E) → réception chez nous. Inclut le trajet réseau
                 ET le décalage d'horloge (affiché séparément pour pouvoir corriger).
  - compute_ms : parsing JSON + mise à jour intrabar de TOUS les indicateurs.
Puis, si TELEGRAM_BOT_TOKEN/CHAT_ID sont dans .env : aller-retour réel de N envois.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import time
from pathlib import Path

import httpx
import numpy as np
import websockets

from sentinel.alerts.telegram import TelegramClient
from sentinel.core.config import Secrets, load_config
from sentinel.core.logging import configure_logging
from sentinel.core.models import Market, StreamKey
from sentinel.data.feeds.binance import parse_kline_message, stream_names
from sentinel.data.history import BinanceHistory, ParquetCache, load_warmup
from sentinel.indicators.engine import IndicatorEngine


def pct(a: list[float]) -> str:
    if not a:
        return "n=0"
    x = np.array(a)
    return (
        f"n={len(x)}  p50={np.percentile(x, 50):.2f}  p95={np.percentile(x, 95):.2f}  "
        f"p99={np.percentile(x, 99):.2f}  max={x.max():.2f}"
    )


async def main(config: list[str], seconds: float, tg_samples: int) -> None:
    configure_logging("WARNING")
    cfg = load_config(*[Path(c) for c in config])
    market = cfg.markets[0]
    keys = [StreamKey(market, s, tf) for s in cfg.watchlist for tf in cfg.timeframes]

    async with httpx.AsyncClient(timeout=20) as http:
        hist = BinanceHistory(cfg.binance, http)
        skew, unc = await hist.estimate_clock_skew(market)
        print(f"Horloge locale − serveur Binance : {skew:+.1f} ms (incertitude ± {unc:.0f} ms)")
        engines: dict[StreamKey, IndicatorEngine] = {}
        t_warm = time.perf_counter()
        for k in keys:
            e = IndicatorEngine(k, cfg.indicators)
            for b in await load_warmup(
                k, cfg.history.warmup_bars, hist, ParquetCache(cfg.history.cache_dir)
            ):
                e.update(b)
            engines[k] = e
        print(f"Chauffe de {len(keys)} moteurs : {time.perf_counter() - t_warm:.1f} s")
        for k, e in engines.items():
            s = e.last
            if s and s.rsi is not None and s.atr is not None:
                print(
                    f"  {k!s:<22} close={s.close:<10g} RSI={s.rsi:5.1f} ATR={s.atr:<9.4g} "
                    f"EMA50={s.ema.get(50) or 0:<10.6g} tendance={s.trend} prêt={s.ready}"
                )

    url = f"{cfg.binance.ws(market).rstrip('/')}/stream?streams=" + "/".join(
        stream_names(cfg.watchlist, cfg.timeframes)
    )
    network, compute = [], []
    closes = 0
    print(f"\nÉcoute WebSocket {market} pendant {seconds:.0f} s…")
    async with websockets.connect(url, ping_interval=20) as ws:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.monotonic()))
            except TimeoutError:
                break
            mono = time.perf_counter_ns()
            wall = time.time_ns() // 1_000_000
            bar = parse_kline_message(raw, Market(market), wall, mono)
            if bar is None:
                continue
            eng = engines[bar.key]
            if bar.closed:
                with contextlib.suppress(Exception):
                    eng.update(bar)
                closes += 1
            else:
                eng.preview(bar)
            compute.append((time.perf_counter_ns() - mono) / 1e6)
            network.append(wall - bar.event_time_ms)
    print(f"  network_ms (E→réception, brut)       : {pct(network)}")
    print(
        f"  network_ms corrigé du décalage horloge: {pct([n - skew for n in network])}"
        f"  (± {unc:.0f} ms)"
    )
    print(f"  compute_ms (parse + indicateurs)      : {pct(compute)}")
    print(f"  bougies clôturées reçues : {closes}")

    secrets = Secrets()
    if secrets.telegram_bot_token and secrets.telegram_chat_id and tg_samples > 0:
        async with TelegramClient(secrets.telegram_bot_token, secrets.telegram_chat_id) as tg:
            t = time.perf_counter()
            await tg.warmup()
            print(
                "\nTelegram : connexion + getMe à froid = "
                f"{(time.perf_counter() - t) * 1000:.0f} ms"
            )
            rt = []
            for i in range(tg_samples):
                sent = await tg.send_message(f"[TEST LATENCE] {i + 1}/{tg_samples}")
                rt.append(sent.roundtrip_ms)
                await asyncio.sleep(1.1)  # limite Telegram ≈ 1 msg/s par chat
            print(f"  Telegram aller-retour (connexion chaude) : {pct(rt)}")
    else:
        print("\nTelegram non configuré (.env) : aller-retour Telegram non mesuré.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", action="append", default=None)
    ap.add_argument("--seconds", type=float, default=60)
    ap.add_argument("--telegram-samples", type=int, default=5)
    a = ap.parse_args()
    asyncio.run(main(a.config or ["config/config.yaml"], a.seconds, a.telegram_samples))
