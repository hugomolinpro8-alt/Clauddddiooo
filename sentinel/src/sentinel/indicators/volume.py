"""VWAP (ancré sur la journée UTC) et volume relatif."""

from __future__ import annotations

from sentinel.indicators.moving import SMA

_DAY_MS = 86_400_000


class SessionVWAP:
    """VWAP réinitialisé chaque jour à 00:00 UTC (la crypto n'a pas de séance : c'est la
    convention la plus répandue, utilisée par Binance/TradingView).

    Prix typique (H+L+C)/3 pondéré par le volume. N'a de sens qu'en intraday :
    sur des bougies journalières, il vaut simplement le prix typique de la bougie.
    """

    __slots__ = ("_day", "_pv", "_v")

    def __init__(self) -> None:
        self._day: int | None = None
        self._pv = 0.0
        self._v = 0.0

    def _state_for(self, open_time_ms: int) -> tuple[float, float]:
        if self._day != open_time_ms // _DAY_MS:
            return 0.0, 0.0
        return self._pv, self._v

    @staticmethod
    def _vwap(pv: float, v: float, tp: float) -> float:
        return pv / v if v > 0 else tp

    def update(
        self, open_time_ms: int, high: float, low: float, close: float, volume: float
    ) -> float:
        pv, v = self._state_for(open_time_ms)
        tp = (high + low + close) / 3.0
        self._day = open_time_ms // _DAY_MS
        self._pv, self._v = pv + tp * volume, v + volume
        return self._vwap(self._pv, self._v, tp)

    def preview(
        self, open_time_ms: int, high: float, low: float, close: float, volume: float
    ) -> float:
        pv, v = self._state_for(open_time_ms)
        tp = (high + low + close) / 3.0
        return self._vwap(pv + tp * volume, v + volume, tp)


class RelativeVolume:
    """Volume de la bougie / moyenne des `period` bougies PRÉCÉDENTES.

    On exclut la bougie courante de la moyenne : sinon un pic de volume se dilue
    lui-même et le signal « volume anormal » est sous-estimé.

    Limite en intrabar : une bougie à moitié écoulée a mécaniquement moins de volume.
    Le volume relatif intrabar est donc biaisé à la baisse (à corriger en phase 5 par
    un prorata temporel si on active l'intrabar).
    """

    __slots__ = ("_avg",)

    def __init__(self, period: int = 20) -> None:
        self._avg = SMA(period)

    def update(self, volume: float) -> float | None:
        avg = self._avg.value
        self._avg.update(volume)
        return volume / avg if avg else None

    def preview(self, volume: float) -> float | None:
        avg = self._avg.value
        return volume / avg if avg else None
