"""Interface commune des stratégies : le MÊME objet sert au backtest et au live.

Une stratégie reçoit, à chaque clôture de sa bougie principale, le snapshot d'indicateurs
de cette bougie et ceux des unités de temps de contexte (déjà clôturées). Elle renvoie
éventuellement un `Setup` : sens, niveau d'invalidation (stop) défini AVANT l'entrée,
objectifs et règles de gestion. Elle ne voit jamais de donnée future : c'est le moteur
qui lui fournit les snapshots, dans l'ordre chronologique.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Protocol

from sentinel.core.models import Bar, Timeframe
from sentinel.indicators.engine import IndicatorSnapshot


class Side(IntEnum):
    LONG = 1
    SHORT = -1


@dataclass(frozen=True, slots=True)
class Setup:
    strategy: str
    side: Side
    signal_close: (
        float  # prix de clôture au signal (l'entrée réelle se fait à l'ouverture suivante)
    )
    stop: float  # niveau d'invalidation, fixé avant l'entrée
    tp1_r: float  # 1er objectif en multiples du risque
    tp1_frac: float  # fraction de la position prise à TP1
    trail_atr: float  # stop suiveur après TP1 : extrême depuis l'entrée ∓ trail_atr × ATR
    time_stop_bars: int  # sortie si TP1 non atteint après N bougies
    reason: str
    time_ms: int
    # Sortie par canal (Donchian) : stop suiveur = plus bas (long) / plus haut (short) des
    # N dernières bougies, actif dès l'entrée. 0 = désactivé.
    exit_channel: int = 0


class Strategy(Protocol):
    name: str
    label: str
    horizon: str
    profile_warnings: tuple[str, ...]
    timeframe: Timeframe
    context: tuple[Timeframe, ...]

    def on_bar(
        self, snap: IndicatorSnapshot, ctx: dict[Timeframe, IndicatorSnapshot | None], bar: Bar
    ) -> Setup | None: ...
