"""Moteur d'indicateurs : un par flux (marché, symbole, unité de temps).

Reçoit les bougies clôturées dans l'ordre, met tout à jour en O(1), et produit un
`IndicatorSnapshot` immuable que les stratégies lisent. Il détecte aussi les trous :
si une bougie manque (coupure réseau), les indicateurs seraient faux → on lève
`GapDetected` et le pipeline recharge les bougies manquantes avant de continuer.
"""

from __future__ import annotations

from dataclasses import dataclass

from sentinel.core.config import IndicatorConfig
from sentinel.core.models import Bar, StreamKey
from sentinel.indicators.moving import EMA, SMA, Highest, Lowest
from sentinel.indicators.oscillators import MACD, RSI, MACDValue
from sentinel.indicators.structure import (
    Level,
    MarketStructure,
    SupportResistance,
    SwingDetector,
    SwingPoint,
    Trend,
)
from sentinel.indicators.volatility import ATR, Bollinger, BollingerValue
from sentinel.indicators.volume import RelativeVolume, SessionVWAP


class GapDetected(Exception):
    def __init__(self, key: StreamKey, expected_ms: int, got_ms: int) -> None:
        self.key, self.expected_ms, self.got_ms = key, expected_ms, got_ms
        super().__init__(f"{key}: bougie attendue à {expected_ms}, reçue {got_ms}")


@dataclass(frozen=True, slots=True)
class IndicatorSnapshot:
    key: StreamKey
    open_time_ms: int
    close: float
    is_preview: bool
    bars_seen: int
    ema: dict[int, float | None]
    sma: dict[int, float | None]
    rsi: float | None
    macd: MACDValue | None
    atr: float | None
    bb: BollingerValue | None
    vwap: float | None
    relvol: float | None
    highest: float | None
    lowest: float | None
    trend: Trend
    last_swing_high: SwingPoint | None
    last_swing_low: SwingPoint | None
    support: Level | None
    resistance: Level | None

    @property
    def ready(self) -> bool:
        """Vrai quand tous les indicateurs principaux sont chauds — pas de signal avant."""
        return (
            all(v is not None for v in self.ema.values())
            and self.rsi is not None
            and self.atr is not None
            and self.bb is not None
            and self.macd is not None
            and self.macd.signal is not None
        )


class IndicatorEngine:
    def __init__(self, key: StreamKey, cfg: IndicatorConfig, strict_gaps: bool = True) -> None:
        self.key = key
        self.cfg = cfg
        # strict_gaps=False : pour le backtest sur archives, où un trou correspond à une
        # vraie fermeture du marché (maintenance Binance), pas à une perte de données.
        self.strict_gaps = strict_gaps
        self.gaps_tolerated = 0
        self.reset()

    def reset(self) -> None:
        """Remet tous les indicateurs à zéro (après un trou de données impossible à combler)."""
        cfg = self.cfg
        self.ema = {p: EMA(p) for p in cfg.ema_periods}
        self.sma = {p: SMA(p) for p in cfg.sma_periods}
        self.rsi = RSI(cfg.rsi_period)
        self.macd = MACD(*cfg.macd)
        self.atr = ATR(cfg.atr_period)
        self.bb = Bollinger(cfg.bb_period, cfg.bb_k)
        self.vwap = SessionVWAP()
        self.relvol = RelativeVolume(cfg.relvol_period)
        self.highest = Highest(cfg.hl_lookback)
        self.lowest = Lowest(cfg.hl_lookback)
        self.swings = SwingDetector(cfg.swing_k)
        self.structure = MarketStructure()
        self.sr = SupportResistance(cfg.sr_tolerance_pct, cfg.sr_max_levels)
        self.last_open_ms: int | None = None
        self.bars_seen = 0
        self._last: IndicatorSnapshot | None = None

    @property
    def last(self) -> IndicatorSnapshot | None:
        return self._last

    def update(self, bar: Bar) -> IndicatorSnapshot | None:
        """Intègre une bougie CLÔTURÉE. Renvoie None si doublon / bougie ancienne."""
        if not bar.closed:
            raise ValueError("update() n'accepte que des bougies clôturées ; utiliser preview()")
        tf_ms = self.key.timeframe.ms
        if self.last_open_ms is not None:
            if bar.open_time_ms <= self.last_open_ms:
                return None  # doublon (ex. message rejoué après reconnexion)
            expected = self.last_open_ms + tf_ms
            if bar.open_time_ms != expected:
                if self.strict_gaps:
                    raise GapDetected(self.key, expected, bar.open_time_ms)
                self.gaps_tolerated += 1

        c = bar.close
        ema = {p: e.update(c) for p, e in self.ema.items()}
        sma = {p: s.update(c) for p, s in self.sma.items()}
        rsi = self.rsi.update(c)
        macd = self.macd.update(c)
        atr = self.atr.update(bar.high, bar.low, c)
        bb = self.bb.update(c)
        vwap = self.vwap.update(bar.open_time_ms, bar.high, bar.low, c, bar.volume)
        relvol = self.relvol.update(bar.volume)
        hi = self.highest.update(bar.high)
        lo = self.lowest.update(bar.low)
        for p in self.swings.update(bar.open_time_ms, bar.high, bar.low):
            self.structure.add(p)
            self.sr.add(p)

        self.last_open_ms = bar.open_time_ms
        self.bars_seen += 1
        self._last = self._snapshot(bar, False, ema, sma, rsi, macd, atr, bb, vwap, relvol, hi, lo)
        return self._last

    def preview(self, bar: Bar) -> IndicatorSnapshot:
        """Valeurs intrabar sur la bougie en cours, sans modifier l'état.
        La structure (pivots, S/R) reste celle des bougies clôturées."""
        c = bar.close
        return self._snapshot(
            bar,
            True,
            {p: e.preview(c) for p, e in self.ema.items()},
            {p: s.preview(c) for p, s in self.sma.items()},
            self.rsi.preview(c),
            self.macd.preview(c),
            self.atr.preview(bar.high, bar.low, c),
            self.bb.preview(c),
            self.vwap.preview(bar.open_time_ms, bar.high, bar.low, c, bar.volume),
            self.relvol.preview(bar.volume),
            self.highest.preview(bar.high),
            self.lowest.preview(bar.low),
        )

    def _snapshot(
        self,
        bar: Bar,
        is_preview: bool,
        ema: dict[int, float | None],
        sma: dict[int, float | None],
        rsi: float | None,
        macd: MACDValue | None,
        atr: float | None,
        bb: BollingerValue | None,
        vwap: float | None,
        relvol: float | None,
        hi: float | None,
        lo: float | None,
    ) -> IndicatorSnapshot:
        sup, res = self.sr.nearest(bar.close)
        return IndicatorSnapshot(
            key=self.key,
            open_time_ms=bar.open_time_ms,
            close=bar.close,
            is_preview=is_preview,
            bars_seen=self.bars_seen,
            ema=ema,
            sma=sma,
            rsi=rsi,
            macd=macd,
            atr=atr,
            bb=bb,
            vwap=vwap,
            relvol=relvol,
            highest=hi,
            lowest=lo,
            trend=self.structure.trend,
            last_swing_high=self.structure.last_high,
            last_swing_low=self.structure.last_low,
            support=sup,
            resistance=res,
        )
