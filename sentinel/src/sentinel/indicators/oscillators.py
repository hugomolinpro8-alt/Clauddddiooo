"""RSI (Wilder) et MACD, incrémentaux."""

from __future__ import annotations

from dataclasses import dataclass

from sentinel.indicators.moving import EMA, RMA


def _rsi_from(avg_gain: float | None, avg_loss: float | None) -> float | None:
    if avg_gain is None or avg_loss is None:
        return None
    if avg_loss == 0.0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


class RSI:
    """RSI de Wilder : moyenne lissée des hausses / moyenne lissée des baisses."""

    __slots__ = ("_gain", "_loss", "_prev", "period")

    def __init__(self, period: int = 14) -> None:
        self.period = period
        self._prev: float | None = None
        self._gain = RMA(period)
        self._loss = RMA(period)

    @property
    def value(self) -> float | None:
        return _rsi_from(self._gain.value, self._loss.value)

    def update(self, close: float) -> float | None:
        if self._prev is None:
            self._prev = close
            return None
        ch = close - self._prev
        self._prev = close
        return _rsi_from(self._gain.update(max(ch, 0.0)), self._loss.update(max(-ch, 0.0)))

    def preview(self, close: float) -> float | None:
        if self._prev is None:
            return None
        ch = close - self._prev
        return _rsi_from(self._gain.preview(max(ch, 0.0)), self._loss.preview(max(-ch, 0.0)))


@dataclass(frozen=True, slots=True)
class MACDValue:
    macd: float
    signal: float | None
    hist: float | None


class MACD:
    """MACD = EMA(rapide) − EMA(lente) ; signal = EMA du MACD ; histogramme = différence.

    La ligne de signal ne commence à être alimentée que lorsque le MACD existe
    (EMA lente chaude) — pas de valeurs fictives pendant l'échauffement.
    """

    __slots__ = ("_fast", "_signal", "_slow", "_value")

    def __init__(self, fast: int = 12, slow: int = 26, signal: int = 9) -> None:
        if fast >= slow:
            raise ValueError("fast < slow requis")
        self._fast, self._slow, self._signal = EMA(fast), EMA(slow), EMA(signal)
        self._value: MACDValue | None = None

    @property
    def value(self) -> MACDValue | None:
        return self._value

    @staticmethod
    def _make(m: float, sig: float | None) -> MACDValue:
        return MACDValue(m, sig, None if sig is None else m - sig)

    def update(self, close: float) -> MACDValue | None:
        f, s = self._fast.update(close), self._slow.update(close)
        if f is None or s is None:
            return None
        m = f - s
        self._value = self._make(m, self._signal.update(m))
        return self._value

    def preview(self, close: float) -> MACDValue | None:
        f, s = self._fast.preview(close), self._slow.preview(close)
        if f is None or s is None:
            return None
        m = f - s
        return self._make(m, self._signal.preview(m))
