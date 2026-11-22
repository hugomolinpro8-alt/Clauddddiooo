"""Régime de marché : tendance / range / transition, et volatilité haute / normale / basse.

Pourquoi : une stratégie de suivi de tendance perd de l'argent en range (faux départs
répétés) et une stratégie de retour à la moyenne se fait écraser en tendance. Lire le régime
permet d'activer la bonne famille — à condition que le backtest le confirme.

Règles (journalier) :
  ADX ≥ 25 et EMA50 > EMA200 et close > EMA50 → tendance haussière
  ADX ≥ 25 et EMA50 < EMA200 et close < EMA50 → tendance baissière
  ADX < 20                                     → range
  sinon                                        → transition
  Volatilité : rang de l'ATR % sur ~1 an ≥ 80 % → haute ; ≤ 20 % → basse ; sinon normale.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from sentinel.indicators.engine import IndicatorSnapshot


class TrendRegime(StrEnum):
    UP = "tendance haussière"
    DOWN = "tendance baissière"
    RANGE = "range"
    TRANSITION = "transition"


class VolRegime(StrEnum):
    HIGH = "haute"
    NORMAL = "normale"
    LOW = "basse"


@dataclass(frozen=True, slots=True)
class Regime:
    trend: TrendRegime
    vol: VolRegime | None
    adx: float
    vol_rank: float | None

    def describe(self) -> str:
        vol = f", volatilité {self.vol}" if self.vol else ""
        rank = f" (rang {self.vol_rank:.0%} sur 1 an)" if self.vol_rank is not None else ""
        return f"{self.trend} (ADX {self.adx:.0f}){vol}{rank}"


def classify(snap: IndicatorSnapshot | None) -> Regime | None:
    if snap is None or snap.adx is None:
        return None
    e50, e200, adx = snap.ema.get(50), snap.ema.get(200), snap.adx
    if adx >= 25 and e50 and e200 and e50 > e200 and snap.close > e50:
        trend = TrendRegime.UP
    elif adx >= 25 and e50 and e200 and e50 < e200 and snap.close < e50:
        trend = TrendRegime.DOWN
    elif adx < 20:
        trend = TrendRegime.RANGE
    else:
        trend = TrendRegime.TRANSITION
    vol = None
    if snap.vol_rank is not None:
        vol = (
            VolRegime.HIGH
            if snap.vol_rank >= 0.8
            else VolRegime.LOW
            if snap.vol_rank <= 0.2
            else VolRegime.NORMAL
        )
    return Regime(trend, vol, adx, snap.vol_rank)
