"""Pullback dans la tendance — 4h, filtré par la tendance journalière.

Idée (Seykota : suivre la tendance ; Tudor Jones : défense d'abord) : dans une tendance
haussière établie, on n'achète pas la cassure (chère) mais le repli vers la moyenne rapide,
au moment où le prix la reprend. Le stop se place sous le plus bas du repli : si ce plus bas
casse, la thèse « le repli est terminé » est fausse.

Règles LONG (miroir pour SHORT, perps uniquement) — FIGÉES avant tout backtest :
  Régime journalier : close_D > EMA50_D > EMA200_D
  Tendance 4h       : EMA20 > EMA50, EMA20 montante, close > EMA50
  Déclencheur       : la bougie précédente a clôturé sous/sur l'EMA20 (repli),
                      la bougie courante clôture au-dessus de l'EMA20 ET est haussière
  Stop              : plus bas des `lookback` dernières bougies − 0,25 × ATR
  Filtre de risque  : 0,5 ATR ≤ (close − stop) ≤ 3 ATR (ni stop dans le bruit, ni trop loin)
  Gestion           : 50 % à +2R, stop au point mort, reste en stop suiveur 3 ATR ;
                      sortie temporelle si +2R non atteint en 30 bougies (5 jours)
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, replace

from sentinel.core.models import Bar, Timeframe
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.strategies.base import Setup, Side


@dataclass(frozen=True, slots=True)
class PullbackParams:
    ema_fast: int = 20
    ema_slow: int = 50
    d_fast: int = 50
    d_slow: int = 200
    lookback: int = 5
    stop_buffer_atr: float = 0.25
    min_risk_atr: float = 0.5
    max_risk_atr: float = 3.0
    tp1_r: float = 2.0
    tp1_frac: float = 0.5
    trail_atr: float = 3.0
    time_stop_bars: int = 30
    allow_short: bool = False

    def with_(self, **kw: object) -> PullbackParams:
        return replace(self, **kw)  # type: ignore[arg-type]


class TrendPullback:
    name = "trend_pullback"
    label = "Pullback EMA20 (4h, filtre journalier)"
    horizon = "Swing 1–5 j"
    style = "trend"
    profile_warnings: tuple[str, ...] = (
        "Stratégie REJETÉE au backtest (espérance OOS ≤ 0 après frais).",
    )
    timeframe = Timeframe.H4
    context: tuple[Timeframe, ...] = (Timeframe.D1,)

    def __init__(self, params: PullbackParams | None = None) -> None:
        self.p = params or PullbackParams()
        self._lows: deque[float] = deque(maxlen=self.p.lookback)
        self._highs: deque[float] = deque(maxlen=self.p.lookback)
        self._prev: IndicatorSnapshot | None = None

    def on_bar(
        self, snap: IndicatorSnapshot, ctx: dict[Timeframe, IndicatorSnapshot | None], bar: Bar
    ) -> Setup | None:
        p = self.p
        self._lows.append(bar.low)
        self._highs.append(bar.high)
        prev, self._prev = self._prev, snap
        d = ctx.get(Timeframe.D1)
        if prev is None or d is None or not snap.ready or not d.ready:
            return None
        ef, es = snap.ema[p.ema_fast], snap.ema[p.ema_slow]
        pef = prev.ema[p.ema_fast]
        dfa, dsl = d.ema[p.d_fast], d.ema[p.d_slow]
        atr = snap.atr
        if ef is None or es is None or pef is None or dfa is None or dsl is None or not atr:
            return None
        c = bar.close

        if (
            d.close > dfa > dsl
            and ef > es
            and c > es
            and prev.close <= pef < ef < c
            and c > bar.open
        ):
            stop = min(self._lows) - p.stop_buffer_atr * atr
            if p.min_risk_atr * atr <= c - stop <= p.max_risk_atr * atr:
                return self._setup(
                    Side.LONG,
                    c,
                    stop,
                    bar,
                    "pullback sur EMA20 en tendance haussière 4h + journalier",
                )
        if (
            p.allow_short
            and d.close < dfa < dsl
            and ef < es
            and c < es
            and prev.close >= pef > ef > c
            and c < bar.open
        ):
            stop = max(self._highs) + p.stop_buffer_atr * atr
            if p.min_risk_atr * atr <= stop - c <= p.max_risk_atr * atr:
                return self._setup(
                    Side.SHORT,
                    c,
                    stop,
                    bar,
                    "rebond sur EMA20 en tendance baissière 4h + journalier",
                )
        return None

    def _setup(self, side: Side, close: float, stop: float, bar: Bar, reason: str) -> Setup:
        p = self.p
        return Setup(
            self.name,
            side,
            close,
            stop,
            p.tp1_r,
            p.tp1_frac,
            p.trail_atr,
            p.time_stop_bars,
            reason,
            bar.close_time_ms,
        )
