"""Modèles de données du chemin critique.

Choix : des dataclasses `slots=True` plutôt que des modèles pydantic. Sur le chemin
critique on crée un objet par message WebSocket ; une dataclass à slots se construit
~10x plus vite qu'un modèle pydantic validé. La validation est faite une seule fois,
au parsing du message brut.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Market(StrEnum):
    SPOT = "spot"
    PERP = "perp"


class Timeframe(StrEnum):
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"

    @property
    def seconds(self) -> int:
        return _TF_SECONDS[self]

    @property
    def ms(self) -> int:
        return _TF_SECONDS[self] * 1000


_TF_SECONDS: dict[Timeframe, int] = {
    Timeframe.M1: 60,
    Timeframe.M5: 300,
    Timeframe.M15: 900,
    Timeframe.H1: 3600,
    Timeframe.H4: 14400,
    Timeframe.D1: 86400,
}


@dataclass(frozen=True, slots=True)
class StreamKey:
    """Identifie un flux de bougies : (marché, symbole, unité de temps)."""

    market: Market
    symbol: str
    timeframe: Timeframe

    def __str__(self) -> str:
        return f"{self.market}:{self.symbol}:{self.timeframe}"


@dataclass(frozen=True, slots=True)
class Bar:
    """Une bougie OHLCV.

    `closed=False` : bougie en cours (mise à jour intrabar).
    `closed=True`  : bougie définitivement clôturée — seule base fiable par défaut.

    Horodatages (latence) :
      - event_time_ms : horloge de l'exchange au moment de l'événement (champ `E` Binance).
      - recv_wall_ms  : notre horloge murale à la réception (dépend de la synchro NTP).
      - recv_mono_ns  : horloge monotone locale à la réception — sert à mesurer la
                        latence *système* sans être faussée par un décalage d'horloge.
    """

    key: StreamKey
    open_time_ms: int
    close_time_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    closed: bool
    event_time_ms: int = 0
    recv_wall_ms: int = 0
    recv_mono_ns: int = 0

    @property
    def symbol(self) -> str:
        return self.key.symbol

    @property
    def timeframe(self) -> Timeframe:
        return self.key.timeframe
