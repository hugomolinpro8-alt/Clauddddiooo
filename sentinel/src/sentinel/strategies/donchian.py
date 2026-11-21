"""Suivi de tendance moyen terme — cassure de canal de Donchian, en journalier.

Famille la plus documentée en crypto (« time-series momentum ») et la philosophie de
Seykota/des Turtles : on n'essaie pas de prédire, on achète ce qui monte vraiment (nouveau
plus haut sur 55 jours), on coupe vite (stop initial 2 ATR), et on laisse courir tant que
la tendance tient (sortie seulement quand le prix casse le plus bas des 20 derniers jours).

Conséquence assumée : beaucoup de petites pertes, peu de gros gains. Le win rate sera bas
(30-40 %) ; seul compte le rapport gain moyen / perte moyenne.

Règles LONG (miroir pour SHORT, perps uniquement) — FIGÉES avant tout backtest :
  Entrée : clôture journalière > plus haut des `entry_n` jours PRÉCÉDENTS (jour courant exclu)
  Stop initial : clôture − `stop_atr` × ATR(14)
  Sortie : stop suiveur = plus bas des `exit_n` derniers jours (canal), jamais abaissé
  Pas d'objectif fixe, pas de sortie temporelle : on laisse courir.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, replace

from sentinel.core.models import Bar, Timeframe
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.strategies.base import Setup, Side


@dataclass(frozen=True, slots=True)
class DonchianParams:
    entry_n: int = 55
    exit_n: int = 20
    stop_atr: float = 2.0
    allow_short: bool = False

    def with_(self, **kw: object) -> DonchianParams:
        return replace(self, **kw)  # type: ignore[arg-type]


class DonchianTrend:
    name = "donchian_trend"
    timeframe = Timeframe.D1
    context: tuple[Timeframe, ...] = ()

    def __init__(self, params: DonchianParams | None = None) -> None:
        self.p = params or DonchianParams()
        self._highs: deque[float] = deque(maxlen=self.p.entry_n)
        self._lows: deque[float] = deque(maxlen=self.p.entry_n)

    def on_bar(
        self, snap: IndicatorSnapshot, ctx: dict[Timeframe, IndicatorSnapshot | None], bar: Bar
    ) -> Setup | None:
        p = self.p
        full = len(self._highs) == p.entry_n
        upper = max(self._highs) if full else math.inf
        lower = min(self._lows) if full else -math.inf
        # Le canal est calculé AVANT d'ajouter la bougie du jour : sinon la clôture ne pourrait
        # jamais dépasser un plus haut qui inclut son propre plus haut.
        self._highs.append(bar.high)
        self._lows.append(bar.low)
        atr = snap.atr
        if not full or not atr:
            return None
        c = bar.close
        if c > upper:
            return self._setup(
                Side.LONG, c, c - p.stop_atr * atr, bar, f"cassure du plus haut {p.entry_n} jours"
            )
        if p.allow_short and c < lower:
            return self._setup(
                Side.SHORT, c, c + p.stop_atr * atr, bar, f"cassure du plus bas {p.entry_n} jours"
            )
        return None

    def _setup(self, side: Side, close: float, stop: float, bar: Bar, reason: str) -> Setup:
        return Setup(
            strategy=self.name,
            side=side,
            signal_close=close,
            stop=stop,
            tp1_r=math.inf,  # pas d'objectif : on laisse courir
            tp1_frac=0.5,
            trail_atr=math.inf,
            time_stop_bars=10**9,
            reason=reason,
            time_ms=bar.close_time_ms,
            exit_channel=self.p.exit_n,
        )
