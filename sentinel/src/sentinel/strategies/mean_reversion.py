"""Retour à la moyenne en range — 4h, activé seulement si le journalier est en range.

Idée : quand il n'y a pas de tendance (ADX journalier bas), les excès autour de la moyenne
tendent à se résorber. On achète un excès baissier (sous la bande de Bollinger basse, RSI bas)
pour viser le retour à la moyenne mobile 20. En tendance, ce même signal est un piège
(« acheter un couteau qui tombe ») : d'où le filtre de régime.

Règles LONG (miroir SHORT, perps uniquement) — FIGÉES avant tout backtest :
  Régime : ADX journalier < 20 (range)
  Entrée : clôture 4h < bande de Bollinger basse (20, 2) et RSI(14) < 30
  Stop : clôture − 1,5 ATR(14) ; objectif : moyenne de Bollinger (100 % de la position)
  Sortie temporelle : 12 bougies (2 jours) si l'objectif n'est pas atteint
  Filtre : objectif ≥ 0,5 R (sinon le gain potentiel ne paie pas le risque)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

from sentinel.core.models import Bar, Timeframe
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.strategies.base import Setup, Side


@dataclass(frozen=True, slots=True)
class MeanReversionParams:
    adx_max: float = 20.0
    rsi_max: float = 30.0
    stop_atr: float = 1.5
    time_stop_bars: int = 12
    min_target_r: float = 0.5
    allow_short: bool = False

    def with_(self, **kw: object) -> MeanReversionParams:
        return replace(self, **kw)  # type: ignore[arg-type]


class RangeReversion:
    name = "range_reversion"
    label = "Retour à la moyenne en range (4h, filtre journalier)"
    horizon = "Court terme (1–2 j)"
    style = "mean_reversion"
    timeframe = Timeframe.H4
    context: tuple[Timeframe, ...] = (Timeframe.D1,)
    profile_warnings: tuple[str, ...] = (
        "Retour à la moyenne : gains plafonnés à la moyenne, pertes au stop ; une sortie de "
        "range (cassure) fait perdre le stop entier.",
    )

    def __init__(self, params: MeanReversionParams | None = None) -> None:
        self.p = params or MeanReversionParams()

    def on_bar(
        self, snap: IndicatorSnapshot, ctx: dict[Timeframe, IndicatorSnapshot | None], bar: Bar
    ) -> Setup | None:
        p, d = self.p, ctx.get(Timeframe.D1)
        if d is None or d.adx is None or d.adx >= p.adx_max:
            return None
        bb, rsi, atr, c = snap.bb, snap.rsi, snap.atr, bar.close
        if bb is None or rsi is None or not atr:
            return None
        if c < bb.lower and rsi < p.rsi_max:
            stop = c - p.stop_atr * atr
            tgt_r = (bb.mid - c) / (c - stop)
            if tgt_r >= p.min_target_r:
                return self._setup(
                    Side.LONG, c, stop, tgt_r, bar, "excès sous la bande basse en range"
                )
        if p.allow_short and c > bb.upper and rsi > 100 - p.rsi_max:
            stop = c + p.stop_atr * atr
            tgt_r = (c - bb.mid) / (stop - c)
            if tgt_r >= p.min_target_r:
                return self._setup(
                    Side.SHORT, c, stop, tgt_r, bar, "excès au-dessus de la bande haute en range"
                )
        return None

    def _setup(
        self, side: Side, close: float, stop: float, tgt_r: float, bar: Bar, reason: str
    ) -> Setup:
        return Setup(
            self.name,
            side,
            close,
            stop,
            tgt_r,
            1.0,
            math.inf,
            self.p.time_stop_bars,
            reason,
            bar.close_time_ms,
        )
