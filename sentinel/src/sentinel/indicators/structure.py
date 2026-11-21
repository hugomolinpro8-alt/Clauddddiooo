"""Structure de marché : pivots (swings), tendance HH/HL vs LH/LL, supports/résistances.

LOOK-AHEAD — point crucial : un plus haut « pivot » à la bougie i n'est connu qu'après
avoir vu les k bougies suivantes. Beaucoup de backtests amateurs marquent le pivot
à la date i, ce qui revient à lire l'avenir. Ici, chaque pivot porte deux dates :
`time_ms` (où il se situe) et `confirmed_ms` (quand on a pu le savoir). Toute logique
de décision n'utilise que des pivots dont confirmed_ms <= maintenant.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import StrEnum


class SwingKind(StrEnum):
    HIGH = "high"
    LOW = "low"


class Trend(StrEnum):
    UP = "up"  # plus hauts et plus bas croissants (HH + HL)
    DOWN = "down"  # plus hauts et plus bas décroissants (LH + LL)
    NEUTRAL = "neutral"  # structure mixte / pas assez de pivots


@dataclass(frozen=True, slots=True)
class SwingPoint:
    kind: SwingKind
    price: float
    time_ms: int
    confirmed_ms: int


class SwingDetector:
    """Pivot haut à i si high[i] > les k highs à gauche et >= les k highs à droite
    (asymétrie stricte/large pour ne pas compter deux fois un double sommet égal)."""

    __slots__ = ("_buf", "k")

    def __init__(self, k: int = 3) -> None:
        if k < 1:
            raise ValueError("k >= 1")
        self.k = k
        self._buf: deque[tuple[int, float, float]] = deque(maxlen=2 * k + 1)

    def update(self, open_time_ms: int, high: float, low: float) -> list[SwingPoint]:
        self._buf.append((open_time_ms, high, low))
        if len(self._buf) < 2 * self.k + 1:
            return []
        items = list(self._buf)
        t, h, lo = items[self.k]
        left, right = items[: self.k], items[self.k + 1 :]
        out: list[SwingPoint] = []
        if all(h > x[1] for x in left) and all(h >= x[1] for x in right):
            out.append(SwingPoint(SwingKind.HIGH, h, t, open_time_ms))
        if all(lo < x[2] for x in left) and all(lo <= x[2] for x in right):
            out.append(SwingPoint(SwingKind.LOW, lo, t, open_time_ms))
        return out


class MarketStructure:
    """Compare les deux derniers pivots hauts et bas confirmés."""

    __slots__ = ("highs", "lows")

    def __init__(self) -> None:
        self.highs: deque[SwingPoint] = deque(maxlen=2)
        self.lows: deque[SwingPoint] = deque(maxlen=2)

    def add(self, p: SwingPoint) -> None:
        (self.highs if p.kind is SwingKind.HIGH else self.lows).append(p)

    @property
    def trend(self) -> Trend:
        if len(self.highs) < 2 or len(self.lows) < 2:
            return Trend.NEUTRAL
        hh = self.highs[1].price > self.highs[0].price
        hl = self.lows[1].price > self.lows[0].price
        lh = self.highs[1].price < self.highs[0].price
        ll = self.lows[1].price < self.lows[0].price
        if hh and hl:
            return Trend.UP
        if lh and ll:
            return Trend.DOWN
        return Trend.NEUTRAL

    @property
    def last_high(self) -> SwingPoint | None:
        return self.highs[-1] if self.highs else None

    @property
    def last_low(self) -> SwingPoint | None:
        return self.lows[-1] if self.lows else None


@dataclass(frozen=True, slots=True)
class Level:
    """Immuable : un snapshot passé ne doit jamais changer quand le niveau est retouché
    plus tard (sinon une décision passée « verrait » le futur dans un backtest)."""

    price: float
    touches: int
    last_ms: int


class SupportResistance:
    """Niveaux issus des pivots confirmés, regroupés s'ils sont à moins de `tol_pct` %.

    Un niveau touché plusieurs fois est plus significatif (touches). On garde les
    `max_levels` plus récents : un niveau d'il y a 3 ans pèse peu sur un swing de 3 jours.
    """

    __slots__ = ("levels", "max_levels", "tol_pct")

    def __init__(self, tol_pct: float = 0.4, max_levels: int = 12) -> None:
        self.tol_pct = tol_pct
        self.max_levels = max_levels
        self.levels: list[Level] = []

    def add(self, p: SwingPoint) -> None:
        for i, lvl in enumerate(self.levels):
            if abs(lvl.price - p.price) / lvl.price * 100.0 <= self.tol_pct:
                self.levels[i] = Level(
                    (lvl.price * lvl.touches + p.price) / (lvl.touches + 1),
                    lvl.touches + 1,
                    p.confirmed_ms,
                )
                return
        self.levels.append(Level(p.price, 1, p.confirmed_ms))
        if len(self.levels) > self.max_levels:
            self.levels.sort(key=lambda lv: lv.last_ms)
            self.levels.pop(0)

    def nearest(self, price: float) -> tuple[Level | None, Level | None]:
        """(support le plus proche sous le prix, résistance la plus proche au-dessus)."""
        sup = max(
            (lv for lv in self.levels if lv.price < price), key=lambda lv: lv.price, default=None
        )
        res = min(
            (lv for lv in self.levels if lv.price > price), key=lambda lv: lv.price, default=None
        )
        return sup, res
