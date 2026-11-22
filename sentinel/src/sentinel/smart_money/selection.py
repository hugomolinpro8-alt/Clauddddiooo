"""Sélection des portefeuilles « smart money » et rejeu de copie — fonctions pures, testées.

Un portefeuille n'est retenu que s'il passe TOUS les filtres :
  1. historique ≥ 6 mois (courbe de valeur du compte perp) ;
  2. drawdown max du PnL cumulé ≤ 30 % de la valeur médiane du compte ;
  3. régularité : ≥ 60 % de mois positifs ET meilleur mois ≤ 50 % des gains (pas un seul coup) ;
  4. levier moyen ≤ 5× et max ≤ 15× sur la période rejouée ;
  5. pas de profil martingale (renforts répétés et croissants dans une position perdante) ;
  6. historique d'exécutions complet sur 90 j (< 10 000 fills : au-delà, l'API tronque ET il
     s'agit souvent de market making/HFT, impossible à copier) ;
  7. REJEU DE COPIE sur 90 jours avec MON capital, mes frais, un délai réaliste et la taille
     minimale d'ordre : rentable après coûts, drawdown ≤ 20 %.

Limites assumées (rappelées dans chaque rapport) : couvertures sur d'autres plateformes et
portefeuilles fractionnés invisibles ; funding non simulé ; le leaderboard n'est pas une API
officielle.
"""

from __future__ import annotations

import bisect
import itertools
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

DAY_MS = 86_400_000


@dataclass(frozen=True, slots=True)
class Criteria:
    min_history_days: int = 180
    max_pnl_drawdown: float = 0.30
    min_positive_months: float = 0.60
    max_best_month_share: float = 0.50
    max_avg_leverage: float = 5.0
    max_peak_leverage: float = 15.0
    max_martingale_share: float = 0.20
    max_fills_90d: int = 9_500
    min_copy_trades: int = 10
    max_copy_drawdown: float = 0.20
    # présélection depuis le classement
    min_account_value: float = 100_000.0
    min_alltime_pnl: float = 100_000.0
    min_month_roi: float = -0.05
    min_alltime_volume: float = 10_000_000.0


# --- 1-3 : historique du compte ------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class TrackRecord:
    history_days: float
    pnl_drawdown: float  # drawdown max de l'indice de rendement pondéré dans le temps
    positive_months: float
    best_month_share: float
    months: int
    median_account_value: float


def _series(portfolio: Mapping[str, Any], key: str) -> list[tuple[int, float]]:
    block = portfolio.get("perpAllTime") or portfolio.get("allTime") or {}
    return [(int(t), float(v)) for t, v in block.get(key, [])]


def twr_drawdown(av: Sequence[tuple[int, float]], pnl: Sequence[tuple[int, float]]) -> float:
    """Drawdown max d'un indice de rendement PONDÉRÉ DANS LE TEMPS : à chaque période,
    rendement = gain de la période / capital en compte au début de la période. Les dépôts,
    retraits et transferts spot↔perp ne faussent pas la mesure (contrairement à « chute du
    PnL / valeur du compte », première version, qui donnait des drawdowns absurdes de 500 %+
    sur les comptes alimentés ou vidés en cours de route).
    Une période où le compte est quasi vide (< 1 % de la médiane) est ignorée."""
    av_at = dict(av)
    pts = [(t, p) for t, p in pnl if t in av_at]
    if len(pts) < 2:
        return math.inf
    med = sorted(v for _, v in av)[len(av) // 2]
    index, peak, mdd = 1.0, 1.0, 0.0
    for (t0, p0), (_t1, p1) in itertools.pairwise(pts):
        cap = av_at[t0]
        if cap < 0.01 * med or cap <= 0:
            continue
        r = max(-1.0, (p1 - p0) / cap)
        index *= 1 + r
        peak = max(peak, index)
        mdd = max(mdd, 1 - index / peak)
    return mdd


def track_record(portfolio: Mapping[str, Any], now_ms: int) -> TrackRecord | None:
    av = [(t, v) for t, v in _series(portfolio, "accountValueHistory") if v > 0]
    pnl = _series(portfolio, "pnlHistory")
    if len(av) < 2 or len(pnl) < 2:
        return None
    hist_days = (now_ms - av[0][0]) / DAY_MS
    values = sorted(v for _, v in av)
    median_av = values[len(values) // 2]
    mdd = twr_drawdown(av, pnl)
    # PnL par mois calendaire (dernier point de chaque mois)
    last_by_month: dict[tuple[int, int], float] = {}
    for t, p in pnl:
        d = datetime.fromtimestamp(t / 1000, UTC)
        last_by_month[(d.year, d.month)] = p
    keys = sorted(last_by_month)
    monthly = [last_by_month[keys[0]] - pnl[0][1]] + [
        last_by_month[b] - last_by_month[a] for a, b in itertools.pairwise(keys)
    ]
    gains = sum(m for m in monthly if m > 0)
    pos = sum(m > 0 for m in monthly) / len(monthly) if monthly else 0.0
    best = max(monthly) / gains if gains > 0 else 1.0
    return TrackRecord(
        hist_days,
        mdd,
        pos,
        best,
        len(monthly),
        median_av,
    )


# --- 5 : martingale ----------------------------------------------------------------------
def martingale_share(fills: Sequence[Mapping[str, Any]], adverse_pct: float = 0.005) -> float:
    """Part des épisodes (position ouverte → fermée) avec ≥ 3 renforts « contre soi » de
    taille non décroissante : profil qui double la mise en perdant (ruine probable un jour)."""
    episodes = flagged = 0
    state: dict[str, dict[str, float]] = {}
    for f in fills:
        coin, px, sz = f["coin"], float(f["px"]), float(f["sz"])
        signed = sz if f["side"] == "B" else -sz
        start = float(f.get("startPosition", 0.0))
        after = start + signed
        if coin not in state and start != 0:
            # position déjà ouverte au début de la fenêtre : c'est aussi un épisode (sinon ses
            # renforts seraient comptés sans l'épisode → parts > 100 %, bug corrigé)
            episodes += 1
            state[coin] = {"avg": px, "adds": 0, "last_add": 0.0}
        st = state.setdefault(coin, {"avg": 0.0, "adds": 0, "last_add": 0.0})
        if start == 0 and after != 0:
            episodes += 1
            st.update(avg=px, adds=0, last_add=0.0)
        elif abs(after) > abs(start) and start != 0 and (after > 0) == (start > 0):
            long = start > 0
            adverse = (
                px < st["avg"] * (1 - adverse_pct) if long else px > st["avg"] * (1 + adverse_pct)
            )
            if adverse and sz >= st["last_add"]:
                st["adds"] += 1
                st["last_add"] = sz
                if st["adds"] == 3:
                    flagged += 1
            st["avg"] = (st["avg"] * abs(start) + px * sz) / abs(after)
        if after == 0 or (start != 0 and (after > 0) != (start > 0)):
            st.update(avg=px if after != 0 else 0.0, adds=0, last_add=0.0)
            if after != 0:
                episodes += 1
    return min(1.0, flagged / episodes) if episodes else 0.0


# --- 7 : rejeu de copie --------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CopyCosts:
    capital: float = 3_000.0
    delay_ms: int = 60_000  # tu reçois l'info, tu décides, tu passes l'ordre : ~1 min
    taker_fee: float = 0.00045  # Hyperliquid, palier de base
    slippage: float = 0.0005
    min_notional: float = 10.0  # taille minimale d'ordre Hyperliquid
    unknown_price_penalty: float = 0.001  # actif sans bougies en cache
    # Un copieur raisonnable plafonne son exposition : sans cela, un compte suivi dont la
    # valeur est mal échantillonnée donne des positions absurdes (levier 238× observé).
    max_gross_leverage: float = 3.0


@dataclass
class CopyResult:
    trades: int = 0
    skipped_small: int = 0
    skipped_no_account: int = 0
    capped: int = 0  # ordres réduits par le plafond de levier
    pnl: float = 0.0
    fees: float = 0.0
    max_drawdown: float = 0.0
    avg_leverage: float = 0.0
    peak_leverage: float = 0.0
    equity_curve: list[tuple[int, float]] = field(default_factory=list)

    @property
    def ret(self) -> float:
        return self.pnl

    def ret_pct(self, capital: float) -> float:
        return self.pnl / capital


class PriceBook:
    """Prix 1 minute par actif : prix au moment (fill + délai)."""

    def __init__(self, candles: Mapping[str, Sequence[Mapping[str, Any]]]) -> None:
        self._t = {c: [int(x["t"]) for x in v] for c, v in candles.items()}
        self._c = {c: [float(x["c"]) for x in v] for c, v in candles.items()}

    def price(self, coin: str, t_ms: int) -> float | None:
        ts = self._t.get(coin)
        if not ts:
            return None
        i = bisect.bisect_right(ts, t_ms) - 1
        if i < 0 or t_ms - ts[i] > 120_000:
            return None
        return self._c[coin][i]


def _value_at(series: Sequence[tuple[int, float]], t: int) -> float:
    if not series:
        return 0.0
    i = bisect.bisect_right([x for x, _ in series], t) - 1
    return series[max(i, 0)][1]


def copy_replay(
    fills: Sequence[Mapping[str, Any]],
    account_values: Sequence[tuple[int, float]],
    prices: PriceBook,
    costs: CopyCosts | None = None,
) -> CopyResult:
    """Rejoue la copie proportionnelle : ma position = leur position × (mon capital / la
    valeur de leur compte au moment du fill), exécutée après `delay_ms`, frais + slippage."""
    costs = costs or CopyCosts()
    res = CopyResult()
    mine: dict[str, float] = defaultdict(float)
    theirs: dict[str, float] = defaultdict(float)
    last_px: dict[str, float] = {}
    cash = 0.0
    peak_eq = 0.0
    lev_samples: list[float] = []
    for f in fills:
        coin, t = f["coin"], int(f["time"])
        px_fill = float(f["px"])
        signed = float(f["sz"]) if f["side"] == "B" else -float(f["sz"])
        theirs[coin] = float(f.get("startPosition", theirs[coin])) + signed
        last_px[coin] = px_fill
        av = _value_at(account_values, t)
        if av <= 0:
            res.skipped_no_account += 1
            continue
        gross = sum(abs(q) * last_px.get(c, 0.0) for c, q in theirs.items())
        lev_samples.append(gross / av)
        target = theirs[coin] * costs.capital / av
        exec_px = prices.price(coin, t + costs.delay_ms)
        penalty = 0.0
        if exec_px is None:
            exec_px, penalty = px_fill, costs.unknown_price_penalty
        others = sum(abs(q) * last_px.get(c, 0.0) for c, q in mine.items() if c != coin)
        room = max(0.0, costs.max_gross_leverage * costs.capital - others)
        if abs(target) * exec_px > room:
            target = math.copysign(room / exec_px, target)
            res.capped += 1
        delta = target - mine[coin]
        closing_all = target == 0 and mine[coin] != 0
        if abs(delta) * exec_px < costs.min_notional and not closing_all:
            res.skipped_small += 1
            continue
        if delta == 0:
            continue
        fill = exec_px * (1 + math.copysign(costs.slippage + penalty, delta))
        fee = abs(delta) * fill * costs.taker_fee
        cash -= delta * fill + fee
        res.fees += fee
        mine[coin] = target
        res.trades += 1
        last_px[coin] = exec_px
        eq = cash + sum(q * last_px.get(c, 0.0) for c, q in mine.items())
        res.equity_curve.append((t, eq))
        peak_eq = max(peak_eq, eq)
        res.max_drawdown = max(res.max_drawdown, (peak_eq - eq) / costs.capital)
    res.pnl = cash + sum(q * last_px.get(c, 0.0) for c, q in mine.items())
    if lev_samples:
        res.avg_leverage = sum(lev_samples) / len(lev_samples)
        res.peak_leverage = max(lev_samples)
    return res


# --- décision ------------------------------------------------------------------------------
@dataclass
class WalletVerdict:
    address: str
    account_value: float
    checks: dict[str, bool] = field(default_factory=dict)
    metrics: dict[str, float] = field(default_factory=dict)
    note: str = ""

    @property
    def selected(self) -> bool:
        return bool(self.checks) and all(self.checks.values())


def prefilter(rows: Sequence[Mapping[str, Any]], c: Criteria, limit: int) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        perf = {k: v for k, v in r.get("windowPerformances", [])}
        at, month = perf.get("allTime", {}), perf.get("month", {})
        try:
            av = float(r["accountValue"])
            ok = (
                av >= c.min_account_value
                and float(at.get("pnl", 0)) >= c.min_alltime_pnl
                and float(at.get("roi", 0)) > 0
                and float(month.get("roi", 0)) >= c.min_month_roi
                and float(at.get("vlm", 0)) >= c.min_alltime_volume
            )
        except (KeyError, ValueError, TypeError):
            continue
        if ok:
            out.append(
                {
                    "address": r["ethAddress"],
                    "account_value": av,
                    "alltime_pnl": float(at.get("pnl", 0)),
                }
            )
    out.sort(key=lambda x: -x["alltime_pnl"])
    return out[:limit]


def evaluate(
    address: str,
    account_value: float,
    record: TrackRecord | None,
    fills: Sequence[Mapping[str, Any]],
    copy: CopyResult | None,
    c: Criteria,
) -> WalletVerdict:
    v = WalletVerdict(address, account_value)
    if record is None:
        v.checks["historique disponible"] = False
        return v
    v.metrics.update(
        history_days=record.history_days,
        pnl_drawdown=record.pnl_drawdown,
        positive_months=record.positive_months,
        best_month_share=record.best_month_share,
        fills_90d=len(fills),
    )
    v.checks[f"historique ≥ {c.min_history_days} j"] = record.history_days >= c.min_history_days
    v.checks[f"drawdown PnL ≤ {c.max_pnl_drawdown:.0%}"] = record.pnl_drawdown <= c.max_pnl_drawdown
    v.checks[f"mois positifs ≥ {c.min_positive_months:.0%}"] = (
        record.positive_months >= c.min_positive_months
    )
    v.checks[f"meilleur mois ≤ {c.max_best_month_share:.0%} des gains"] = (
        record.best_month_share <= c.max_best_month_share
    )
    v.checks[f"fills 90 j < {c.max_fills_90d} (historique complet, pas de HFT)"] = (
        len(fills) < c.max_fills_90d
    )
    mart = martingale_share(fills)
    v.metrics["martingale_share"] = mart
    v.checks["pas de profil martingale"] = mart <= c.max_martingale_share
    if copy is None:
        v.checks["rejeu de copie"] = False
        return v
    v.metrics.update(
        copy_pnl=copy.pnl,
        copy_trades=copy.trades,
        copy_dd=copy.max_drawdown,
        copy_skipped=copy.skipped_small,
        avg_leverage=copy.avg_leverage,
        peak_leverage=copy.peak_leverage,
        copy_fees=copy.fees,
    )
    v.checks[f"levier moyen ≤ {c.max_avg_leverage:g}×"] = copy.avg_leverage <= c.max_avg_leverage
    v.checks[f"levier max ≤ {c.max_peak_leverage:g}×"] = copy.peak_leverage <= c.max_peak_leverage
    v.checks[f"≥ {c.min_copy_trades} trades copiables"] = copy.trades >= c.min_copy_trades
    v.checks["copie rentable après frais/délai"] = copy.pnl > 0
    v.checks[f"drawdown de la copie ≤ {c.max_copy_drawdown:.0%}"] = (
        copy.max_drawdown <= c.max_copy_drawdown
    )
    return v
