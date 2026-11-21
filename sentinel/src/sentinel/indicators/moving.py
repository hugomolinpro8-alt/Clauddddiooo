"""Moyennes et extrema glissants, en O(1) par mise à jour.

Convention commune à tous les indicateurs :
  - `update(x)`  : intègre une valeur *définitive* (bougie clôturée) et renvoie la nouvelle
                   valeur de l'indicateur, ou None tant qu'il n'est pas « chaud ».
  - `preview(x)` : renvoie la valeur qu'aurait l'indicateur si `x` était intégré, SANS
                   modifier l'état. Sert au mode intrabar : la bougie en cours change à
                   chaque tick, on ne doit pas l'intégrer plusieurs fois.
"""

from __future__ import annotations

import math
from collections import deque


class SMA:
    """Moyenne mobile simple : somme glissante (on ajoute l'entrant, on retire le sortant)."""

    __slots__ = ("_buf", "_n", "_sum", "period")

    _RESYNC_EVERY = 10_000

    def __init__(self, period: int) -> None:
        if period < 1:
            raise ValueError("period >= 1")
        self.period = period
        self._buf: deque[float] = deque(maxlen=period)
        self._sum = 0.0
        self._n = 0

    @property
    def ready(self) -> bool:
        return len(self._buf) == self.period

    @property
    def value(self) -> float | None:
        return self._sum / self.period if self.ready else None

    def update(self, x: float) -> float | None:
        if len(self._buf) == self.period:
            self._sum -= self._buf[0]
        self._buf.append(x)
        self._sum += x
        self._n += 1
        if self._n % self._RESYNC_EVERY == 0:
            # Les additions/soustractions flottantes accumulent une petite erreur :
            # on recalcule la somme exacte de temps en temps (coût amorti négligeable).
            self._sum = math.fsum(self._buf)
        return self.value

    def preview(self, x: float) -> float | None:
        if len(self._buf) < self.period - 1:
            return None
        s = self._sum + x - (self._buf[0] if len(self._buf) == self.period else 0.0)
        return s / self.period


class _ExpSmoother:
    """Lissage exponentiel amorcé par une SMA des `period` premières valeurs.

    C'est la convention de TA-Lib / TradingView : évite qu'une seule première valeur
    pèse anormalement lourd au démarrage.
    """

    __slots__ = ("_seed", "_value", "alpha", "period")

    def __init__(self, period: int, alpha: float) -> None:
        self.period = period
        self.alpha = alpha
        self._seed = SMA(period)
        self._value: float | None = None

    @property
    def ready(self) -> bool:
        return self._value is not None

    @property
    def value(self) -> float | None:
        return self._value

    def update(self, x: float) -> float | None:
        if self._value is None:
            self._value = self._seed.update(x)
        else:
            self._value += self.alpha * (x - self._value)
        return self._value

    def preview(self, x: float) -> float | None:
        if self._value is None:
            return self._seed.preview(x)
        return self._value + self.alpha * (x - self._value)


class EMA(_ExpSmoother):
    """Moyenne mobile exponentielle, alpha = 2 / (n + 1)."""

    __slots__ = ()

    def __init__(self, period: int) -> None:
        super().__init__(period, 2.0 / (period + 1))


class RMA(_ExpSmoother):
    """Lissage de Wilder (RSI, ATR), alpha = 1 / n."""

    __slots__ = ()

    def __init__(self, period: int) -> None:
        super().__init__(period, 1.0 / period)


class RollingExtremum:
    """Plus haut (ou plus bas) des `period` dernières valeurs, courante incluse.

    Deque monotone : on ne garde que les candidats qui peuvent encore devenir l'extremum.
    Chaque valeur entre et sort au plus une fois → O(1) amorti.
    """

    __slots__ = ("_dq", "_idx", "_is_max", "period")

    def __init__(self, period: int, *, is_max: bool) -> None:
        self.period = period
        self._is_max = is_max
        self._dq: deque[tuple[int, float]] = deque()
        self._idx = -1

    def _dominates(self, a: float, b: float) -> bool:
        return a >= b if self._is_max else a <= b

    @property
    def ready(self) -> bool:
        return self._idx + 1 >= self.period

    @property
    def value(self) -> float | None:
        return self._dq[0][1] if self.ready and self._dq else None

    def update(self, x: float) -> float | None:
        self._idx += 1
        while self._dq and self._dominates(x, self._dq[-1][1]):
            self._dq.pop()
        self._dq.append((self._idx, x))
        while self._dq[0][0] <= self._idx - self.period:
            self._dq.popleft()
        return self.value

    def preview(self, x: float) -> float | None:
        nxt = self._idx + 1
        if nxt + 1 < self.period:
            return None
        for i, v in self._dq:  # le 1er non expiré est l'extremum de la fenêtre restante
            if i > nxt - self.period:
                return v if self._dominates(v, x) else x
        return x


def Highest(period: int) -> RollingExtremum:
    return RollingExtremum(period, is_max=True)


def Lowest(period: int) -> RollingExtremum:
    return RollingExtremum(period, is_max=False)
