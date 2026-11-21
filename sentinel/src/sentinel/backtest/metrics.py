"""Métriques de performance et simulation de portefeuille.

Deux niveaux :
  1. Statistiques de TRADES en R (indépendantes du capital) : espérance, win rate,
     profit factor… C'est la mesure la plus directe de « l'avantage ».
  2. Courbe d'ÉQUITÉ d'un portefeuille réaliste : risque de X % du capital par trade,
     plafond de notionnel (pas de levier en spot), valorisation quotidienne au prix de
     marché (mark-to-market). Sans MTM, la volatilité serait sous-estimée et le Sharpe
     artificiellement gonflé — erreur fréquente.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from sentinel.backtest.engine import Trade

DAY_MS = 86_400_000


@dataclass(frozen=True, slots=True)
class TradeStats:
    n: int
    win_rate: float
    avg_win_r: float
    avg_loss_r: float
    expectancy_r: float
    expectancy_gross_r: float
    profit_factor: float
    total_r: float
    avg_bars: float
    funding_r: float
    # IC 95 % de l'espérance par bootstrap : si l'IC contient 0, l'avantage n'est pas prouvé.
    exp_ci_low: float
    exp_ci_high: float


def trade_stats(trades: Sequence[Trade], seed: int = 0) -> TradeStats:
    if not trades:
        return TradeStats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    r = np.array([t.r_net for t in trades])
    wins, losses = r[r > 0], r[r <= 0]
    gross_win, gross_loss = wins.sum(), -losses.sum()
    rng = np.random.default_rng(seed)
    boots = rng.choice(r, size=(5000, len(r)), replace=True).mean(axis=1)
    return TradeStats(
        n=len(r),
        win_rate=float(len(wins) / len(r)),
        avg_win_r=float(wins.mean()) if len(wins) else 0.0,
        avg_loss_r=float(losses.mean()) if len(losses) else 0.0,
        expectancy_r=float(r.mean()),
        expectancy_gross_r=float(np.mean([t.r_gross for t in trades])),
        profit_factor=float(gross_win / gross_loss) if gross_loss > 0 else math.inf,
        total_r=float(r.sum()),
        avg_bars=float(np.mean([t.bars_held for t in trades])),
        funding_r=float(sum(t.funding_r for t in trades)),
        exp_ci_low=float(np.percentile(boots, 2.5)),
        exp_ci_high=float(np.percentile(boots, 97.5)),
    )


@dataclass(frozen=True, slots=True)
class EquityStats:
    start_ms: int
    end_ms: int
    cagr: float
    vol: float
    sharpe: float
    sortino: float
    max_dd: float
    mar: float  # CAGR / |max drawdown|
    exposure: float  # fraction des jours avec au moins une position ouverte
    final: float


def equity_stats(times_ms: np.ndarray, equity: np.ndarray, exposure: float = 1.0) -> EquityStats:
    """Statistiques sur une équité QUOTIDIENNE (crypto : 365 jours/an)."""
    rets = np.diff(equity) / equity[:-1]
    years = (times_ms[-1] - times_ms[0]) / DAY_MS / 365.0
    cagr = (equity[-1] / equity[0]) ** (1 / years) - 1 if years > 0 and equity[-1] > 0 else -1.0
    vol = float(rets.std(ddof=1) * math.sqrt(365)) if len(rets) > 1 else 0.0
    mean = float(rets.mean() * 365) if len(rets) else 0.0
    downside = rets[rets < 0]
    dvol = float(math.sqrt((downside**2).sum() / max(len(rets), 1)) * math.sqrt(365))
    peak = np.maximum.accumulate(equity)
    mdd = float((equity / peak - 1).min())
    return EquityStats(
        int(times_ms[0]),
        int(times_ms[-1]),
        float(cagr),
        vol,
        mean / vol if vol > 0 else 0.0,
        mean / dvol if dvol > 0 else 0.0,
        mdd,
        float(cagr / abs(mdd)) if mdd < 0 else math.inf,
        exposure,
        float(equity[-1] / equity[0]),
    )


def daily_grid(start_ms: int, end_ms: int) -> np.ndarray:
    first = (start_ms // DAY_MS + 1) * DAY_MS - 1
    return np.arange(first, end_ms + 1, DAY_MS, dtype=np.int64)


def portfolio_equity(
    trades: Sequence[Trade],
    start_ms: int,
    end_ms: int,
    risk_pct: float = 0.005,
    max_gross_leverage: float = 1.0,
    max_open_risk_pct: float = 0.015,
    capital: float = 1.0,
) -> tuple[np.ndarray, np.ndarray, list[Trade], float]:
    """Simule le portefeuille : chaque trade risque `risk_pct` de l'équité à son entrée,
    sous deux plafonds — notionnel total ≤ max_gross_leverage × équité (1.0 en spot :
    pas d'emprunt) et risque ouvert total ≤ max_open_risk_pct (protège contre les positions
    corrélées : BTC/ETH/SOL chutent ensemble). Trades refusés si aucune marge.

    Renvoie (temps quotidiens, équité MTM, trades réellement pris, exposition)."""
    grid = daily_grid(start_ms, end_ms)
    ordered = sorted(trades, key=lambda t: t.entry_ms)
    closed_pnl = 0.0
    open_: list[tuple[Trade, float, float]] = []  # (trade, montant risqué, notionnel)
    taken: list[Trade] = []
    eq = np.empty(len(grid))
    exposed_days = 0
    i = 0
    for d, day_end in enumerate(grid):
        # entrées et sorties survenues jusqu'à la fin de ce jour, dans l'ordre du temps
        while True:
            next_exit = min((t.exit_ms for t, _, _ in open_), default=None)
            next_entry = ordered[i].entry_ms if i < len(ordered) else None
            cands = [x for x in (next_exit, next_entry) if x is not None and x <= day_end]
            if not cands:
                break
            if next_exit is not None and next_exit == min(cands):
                k = next(j for j, (t, _, _) in enumerate(open_) if t.exit_ms == next_exit)
                t, risk_amt, _ = open_.pop(k)
                closed_pnl += t.r_net * risk_amt
                continue
            t = ordered[i]
            i += 1
            equity_now = capital + closed_pnl
            risk_amt = equity_now * risk_pct
            notional = risk_amt / t.stop_pct
            used_notional = sum(n for _, _, n in open_)
            used_risk = sum(r for _, r, _ in open_)
            room_n = max_gross_leverage * equity_now - used_notional
            room_r = max_open_risk_pct * equity_now - used_risk
            if room_n <= 0 or room_r <= 1e-12:
                continue
            scale = min(1.0, room_n / notional, room_r / risk_amt)
            open_.append((t, risk_amt * scale, notional * scale))
            taken.append(t)
        latent = 0.0
        for t, risk_amt, _ in open_:
            k = np.searchsorted([p[0] for p in t.path], day_end, side="right") - 1
            latent += (t.path[k][1] if k >= 0 else 0.0) * risk_amt
        if open_:
            exposed_days += 1
        eq[d] = capital + closed_pnl + latent
    return grid, eq, taken, exposed_days / max(len(grid), 1)


def buy_and_hold(
    close_times_ms: np.ndarray, closes: np.ndarray, start_ms: int, end_ms: int
) -> tuple[np.ndarray, np.ndarray]:
    grid = daily_grid(start_ms, end_ms)
    idx = np.searchsorted(close_times_ms, grid, side="right") - 1
    valid = idx >= 0
    grid, idx = grid[valid], idx[valid]
    return grid, closes[idx] / closes[idx[0]]
