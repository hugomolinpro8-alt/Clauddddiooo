"""ATR (Wilder) et bandes de Bollinger, incrémentaux."""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass

from sentinel.indicators.moving import RMA


def true_range(high: float, low: float, prev_close: float | None) -> float:
    if prev_close is None:
        return high - low
    return max(high - low, abs(high - prev_close), abs(low - prev_close))


class ATR:
    """Average True Range de Wilder. Mesure l'amplitude « normale » d'une bougie :
    c'est la règle pour placer un stop hors du bruit (ex. 1,5 × ATR)."""

    __slots__ = ("_prev_close", "_rma", "period")

    def __init__(self, period: int = 14) -> None:
        self.period = period
        self._rma = RMA(period)
        self._prev_close: float | None = None

    @property
    def value(self) -> float | None:
        return self._rma.value

    def update(self, high: float, low: float, close: float) -> float | None:
        v = self._rma.update(true_range(high, low, self._prev_close))
        self._prev_close = close
        return v

    def preview(self, high: float, low: float, close: float) -> float | None:
        return self._rma.preview(true_range(high, low, self._prev_close))


@dataclass(frozen=True, slots=True)
class BollingerValue:
    mid: float
    upper: float
    lower: float
    std: float

    @property
    def width(self) -> float:
        """Largeur relative (upper − lower) / mid : sert à détecter les compressions."""
        return (self.upper - self.lower) / self.mid if self.mid else 0.0

    def pct_b(self, price: float) -> float | None:
        span = self.upper - self.lower
        return None if span == 0 else (price - self.lower) / span


class Bollinger:
    """Moyenne ± k écarts-types (population, ddof=0, convention standard de Bollinger).

    Choix délibéré : calcul exact en deux passes sur la fenêtre (O(n), n = 20 → ~2 µs),
    plutôt que la formule O(1) « Σx²/n − mean² ». Cette dernière souffre d'annulation
    catastrophique : un test par propriétés (hypothesis) a trouvé un cas où elle donnait
    un écart-type de 0,0028 au lieu de 0 après un mouvement de prix extrême. Pour 2 µs,
    l'exactitude l'emporte.
    """

    __slots__ = ("_buf", "k", "period")

    def __init__(self, period: int = 20, k: float = 2.0) -> None:
        if period < 2:
            raise ValueError("period >= 2")
        self.period, self.k = period, k
        self._buf: deque[float] = deque(maxlen=period)

    def _compute(self, xs: Iterable[float]) -> BollingerValue:
        vals = list(xs)
        mid = math.fsum(vals) / len(vals)
        std = math.sqrt(math.fsum((x - mid) ** 2 for x in vals) / len(vals))
        return BollingerValue(mid, mid + self.k * std, mid - self.k * std, std)

    @property
    def value(self) -> BollingerValue | None:
        return self._compute(self._buf) if len(self._buf) == self.period else None

    def update(self, x: float) -> BollingerValue | None:
        self._buf.append(x)
        return self.value

    def preview(self, x: float) -> BollingerValue | None:
        if len(self._buf) < self.period - 1:
            return None
        window = list(self._buf)[-(self.period - 1) :] if self.period > 1 else []
        return self._compute([*window, x])
