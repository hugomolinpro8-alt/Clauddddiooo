"""Graphique PNG annoté joint au rapport : bougies, EMA50/200, canal, entrée, stop, repères.

Rendu avec l'API objet de matplotlib (Figure + FigureCanvasAgg), sans `pyplot` : pyplot
garde un état global et n'est pas sûr dans un thread. Le rendu (~100-200 ms) est lancé
via `asyncio.to_thread`, donc jamais sur le chemin critique.
"""

from __future__ import annotations

import io
import math
from datetime import UTC, datetime

import numpy as np
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from sentinel.pipeline.strategy_detector import AlertContext
from sentinel.strategies.base import Side

UP, DOWN = "#1a9e5c", "#d64545"


def _ema(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    out[n - 1] = x[:n].mean()
    a = 2 / (n + 1)
    for i in range(n, len(x)):
        out[i] = out[i - 1] + a * (x[i] - out[i - 1])
    return out


def render_chart(c: AlertContext, n_bars: int = 120) -> bytes:
    hist = list(c.history)
    full_close = np.array([b.close for b in hist])
    ema50, ema200 = _ema(full_close, 50), _ema(full_close, 200)
    hist, ema50, ema200 = hist[-n_bars:], ema50[-n_bars:], ema200[-n_bars:]
    o = np.array([b.open for b in hist])
    h = np.array([b.high for b in hist])
    lo = np.array([b.low for b in hist])
    cl = np.array([b.close for b in hist])
    x = np.arange(len(hist))

    fig = Figure(figsize=(10, 5.6), dpi=110)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(1, 1, 1)
    colors = [UP if c_ >= o_ else DOWN for c_, o_ in zip(cl, o, strict=True)]
    ax.vlines(x, lo, h, colors=colors, linewidth=0.8)
    ax.bar(
        x,
        np.maximum(np.abs(cl - o), (h - lo) * 0.02),
        bottom=np.minimum(o, cl),
        color=colors,
        width=0.7,
    )
    ax.plot(x, ema50, color="#3b6fd8", lw=1.1, label="EMA50")
    if not np.all(np.isnan(ema200)):
        ax.plot(x, ema200, color="#8a5cd1", lw=1.1, label="EMA200")

    s = c.setup
    long = s.side is Side.LONG
    if s.exit_channel:
        n = s.exit_channel
        series = lo if long else h
        chan = [
            series[max(0, i - n + 1) : i + 1].min()
            if long
            else series[max(0, i - n + 1) : i + 1].max()
            for i in range(len(series))
        ]
        ax.plot(x, chan, color="#888", lw=1, ls=":", label=f"canal sortie {n}")

    risk = abs(s.signal_close - s.stop)
    sign = 1 if long else -1
    levels: list[tuple[float, str, str]] = [
        (s.signal_close, "Entrée ≈", "#222"),
        (s.stop, "Stop", DOWN),
    ]
    if math.isinf(s.tp1_r):
        levels += [
            (s.signal_close + sign * 2 * risk, "+2R (repère)", UP),
            (s.signal_close + sign * 4 * risk, "+4R (repère)", UP),
        ]
    else:
        levels.append((s.signal_close + sign * s.tp1_r * risk, f"TP1 +{s.tp1_r:g}R", UP))
    for y, name, col in levels:
        ax.axhline(y, color=col, lw=1, ls="--", alpha=0.8)
        ax.annotate(
            f"{name} {y:,.6g}".replace(",", " "),
            xy=(len(x) + 1.5, y),
            xytext=(6, 0),
            textcoords="offset points",
            va="center",
            fontsize=8,
            color=col,
            annotation_clip=False,
            bbox={"boxstyle": "round,pad=0.2", "fc": "white", "ec": "none", "alpha": 0.85},
        )
    ax.scatter(
        [len(x) + 0.6],
        [s.signal_close],
        marker="^" if long else "v",
        s=90,
        color=UP if long else DOWN,
        zorder=5,
    )

    step = max(1, len(hist) // 8)
    ax.set_xticks(x[::step])
    ax.set_xticklabels(
        [
            datetime.fromtimestamp(b.open_time_ms / 1000, UTC).strftime("%d/%m/%y")
            for b in hist[::step]
        ],
        fontsize=8,
    )
    ax.set_xlim(-1, len(x) + 16)
    ax.grid(alpha=0.25)
    ax.legend(loc="upper left", fontsize=8)
    side = "LONG" if long else "SHORT"
    ax.set_title(
        f"{side} {c.bar.symbol} ({c.bar.key.market}, {c.bar.timeframe}) — {c.strategy_label}",
        fontsize=10,
    )
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    return buf.getvalue()
