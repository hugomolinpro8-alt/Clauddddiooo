"""Score de confluence 0-100 : combien de signaux indépendants vont dans le sens du trade.

Composantes (points max) :
  - Régime (25)          : le régime journalier convient-il à la famille de stratégie ?
  - Technique (35)       : volume relatif (15), momentum MACD (10), RSI sans excès (10)
  - Multi-timeframe (25) : structure alignée en 1j (10), 4h (10), 1h (5)
  - Smart money (15)     : portefeuilles suivis dans le même sens (phase 6)
Une composante sans donnée est EXCLUE du total (pas comptée comme 0) : le score reste sur 100.

Important : un score n'a de valeur que s'il PRÉDIT quelque chose. Il est validé par
`scripts/validate_score.py` (trades à score élevé meilleurs que ceux à score bas, en et
hors échantillon). Tant qu'il ne l'est pas, il est affiché « indicatif » et ne filtre rien.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from sentinel.core.models import Timeframe
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.indicators.structure import Trend
from sentinel.regime.classifier import Regime, TrendRegime, VolRegime
from sentinel.strategies.base import Setup, Side


@dataclass(frozen=True, slots=True)
class SmartMoneyView:
    """Ce que font les portefeuilles suivis sur l'actif (rempli par le module phase 6)."""

    same_side: int
    opposite_side: int
    tracked: int
    details: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Component:
    name: str
    points: float
    max_points: float
    reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Score:
    total: int
    components: tuple[Component, ...] = field(default_factory=tuple)

    def line(self) -> str:
        return " · ".join(f"{c.name} {c.points:.0f}/{c.max_points:.0f}" for c in self.components)


def _regime_component(style: str, long: bool, regime: Regime | None) -> Component | None:
    if regime is None:
        return None
    t = regime.trend
    if style == "trend":
        good = TrendRegime.UP if long else TrendRegime.DOWN
        bad = TrendRegime.DOWN if long else TrendRegime.UP
        pts = 25 if t is good else 12 if t is TrendRegime.TRANSITION else 0
        why = [f"régime {t} pour une stratégie de tendance"]
        if t is bad:
            why.append("régime opposé au trade")
    else:  # retour à la moyenne
        pts = 25 if t is TrendRegime.RANGE else 10 if t is TrendRegime.TRANSITION else 0
        why = [f"régime {t} pour une stratégie de retour à la moyenne"]
    if regime.vol is VolRegime.HIGH:
        pts = max(0, pts - 5)
        why.append("volatilité haute : stops plus souvent touchés par le bruit")
    return Component("Régime", pts, 25, tuple(why))


def _tech_component(snap: IndicatorSnapshot, long: bool, style: str) -> Component:
    pts, why = 0.0, []
    if snap.relvol is not None:
        rv = snap.relvol
        p = 15 if rv >= 2 else 10 if rv >= 1.5 else 5 if rv >= 1 else 0
        pts += p
        why.append(f"volume {rv:.1f}× ({p} pts)")
    if snap.macd and snap.macd.hist is not None:
        aligned = (snap.macd.hist > 0) == long
        if style != "trend":
            aligned = not aligned  # en retour à la moyenne, on achète un momentum baissier épuisé
        pts += 10 if aligned else 0
        why.append("momentum aligné" if aligned else "momentum contraire")
    if snap.rsi is not None:
        r = snap.rsi
        if style == "trend":
            ok = (50 <= r <= 75) if long else (25 <= r <= 50)
        else:
            ok = r <= 35 if long else r >= 65
        pts += 10 if ok else 0
        why.append(f"RSI {r:.0f}{' favorable' if ok else ''}")
    return Component("Technique", pts, 35, tuple(why))


def _mtf_component(
    long: bool, multi_tf: Mapping[Timeframe, IndicatorSnapshot | None], style: str
) -> Component | None:
    want = Trend.UP if long else Trend.DOWN
    pts, mx, why = 0.0, 0.0, []
    for tf, w in ((Timeframe.D1, 10), (Timeframe.H4, 10), (Timeframe.H1, 5)):
        s = multi_tf.get(tf)
        if s is None:
            continue
        mx += w
        if tf is Timeframe.D1:
            e50, e200 = s.ema.get(50), s.ema.get(200)
            ok = bool(e50 and e200 and ((e50 > e200) == long))
        else:
            ok = s.trend is want
        if style != "trend" and tf is not Timeframe.D1:
            ok = s.trend is not (Trend.DOWN if long else Trend.UP)  # pas de chute en cours
        pts += w if ok else 0
        why.append(f"{tf.value} {'aligné' if ok else 'non aligné'}")
    return Component("Multi-UT", pts, mx, tuple(why)) if mx else None


def _smart_component(sm: SmartMoneyView | None) -> Component | None:
    if sm is None or sm.tracked == 0:
        return None
    net = sm.same_side - sm.opposite_side
    pts = max(0.0, min(15.0, 7.5 + 2.5 * net))
    why = (
        f"{sm.same_side} portefeuille(s) suivi(s) dans le même sens, {sm.opposite_side} à "
        f"l'opposé, sur {sm.tracked}",
    )
    return Component("Smart money", pts, 15, why)


def confluence_score(
    setup: Setup,
    snap: IndicatorSnapshot,
    multi_tf: Mapping[Timeframe, IndicatorSnapshot | None],
    regime: Regime | None,
    style: str,
    smart_money: SmartMoneyView | None = None,
) -> Score:
    long = setup.side is Side.LONG
    comps = [
        c
        for c in (
            _regime_component(style, long, regime),
            _tech_component(snap, long, style),
            _mtf_component(long, multi_tf, style),
            _smart_component(smart_money),
        )
        if c is not None
    ]
    mx = sum(c.max_points for c in comps)
    total = round(100 * sum(c.points for c in comps) / mx) if mx else 0
    return Score(total, tuple(comps))
