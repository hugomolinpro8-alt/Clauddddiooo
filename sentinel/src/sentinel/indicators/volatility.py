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


class ADX:
    """Average Directional Index de Wilder : FORCE de la tendance (pas son sens), 0-100.

    +DM = hausse du plus haut si elle dépasse la baisse du plus bas (sinon 0), −DM l'inverse.
    +DI/−DI = lissages de Wilder de ±DM rapportés au lissage du True Range ; DX = |+DI − −DI|
    / (+DI + −DI) ; ADX = lissage de Wilder du DX. Repères usuels : < 20 range, > 25 tendance.
    """

    __slots__ = ("_adx", "_mdm", "_pdm", "_prev", "_tr", "period")

    def __init__(self, period: int = 14) -> None:
        self.period = period
        self._tr, self._pdm, self._mdm, self._adx = (
            RMA(period),
            RMA(period),
            RMA(period),
            RMA(period),
        )
        self._prev: tuple[float, float, float] | None = None  # (high, low, close)

    @property
    def value(self) -> float | None:
        return self._adx.value

    def _dx(self, tr: float | None, pdm: float | None, mdm: float | None) -> float | None:
        if tr is None or pdm is None or mdm is None or tr == 0:
            return None
        pdi, mdi = 100 * pdm / tr, 100 * mdm / tr
        return 0.0 if pdi + mdi == 0 else 100 * abs(pdi - mdi) / (pdi + mdi)

    def _moves(self, high: float, low: float) -> tuple[float, float, float]:
        assert self._prev is not None
        ph, pl, pc = self._prev
        up, down = high - ph, pl - low
        pdm = up if up > down and up > 0 else 0.0
        mdm = down if down > up and down > 0 else 0.0
        return true_range(high, low, pc), pdm, mdm

    def update(self, high: float, low: float, close: float) -> float | None:
        if self._prev is None:
            self._prev = (high, low, close)
            return None
        tr, pdm, mdm = self._moves(high, low)
        self._prev = (high, low, close)
        dx = self._dx(self._tr.update(tr), self._pdm.update(pdm), self._mdm.update(mdm))
        return self._adx.update(dx) if dx is not None else None

    def preview(self, high: float, low: float, close: float) -> float | None:
        if self._prev is None:
            return None
        tr, pdm, mdm = self._moves(high, low)
        dx = self._dx(self._tr.preview(tr), self._pdm.preview(pdm), self._mdm.preview(mdm))
        return self._adx.preview(dx) if dx is not None else self._adx.value


class PercentRank:
    """Rang (0-1) de la dernière valeur dans les `period` dernières : 0,9 = plus haute que 90 %
    des valeurs de l'année. Sert à dire si la volatilité actuelle est haute ou basse POUR CET
    ACTIF (un ATR de 3 % est calme pour SOL, agité pour BTC). O(n) avec n = 365, en journalier."""

    __slots__ = ("_buf",)

    def __init__(self, period: int = 365) -> None:
        self._buf: deque[float] = deque(maxlen=period)

    def _rank(self, x: float, values: Iterable[float]) -> float:
        vals = list(values)
        return sum(v <= x for v in vals) / len(vals)

    def update(self, x: float) -> float | None:
        self._buf.append(x)
        return self._rank(x, self._buf) if len(self._buf) >= 30 else None

    def preview(self, x: float) -> float | None:
        if len(self._buf) < 29:
            return None
        window = list(self._buf)[1:] if len(self._buf) == self._buf.maxlen else list(self._buf)
        return self._rank(x, [*window, x])
