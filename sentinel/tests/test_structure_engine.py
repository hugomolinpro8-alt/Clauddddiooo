from __future__ import annotations

import pytest

from sentinel.core.config import IndicatorConfig
from sentinel.core.models import Bar
from sentinel.indicators.engine import GapDetected, IndicatorEngine
from sentinel.indicators.structure import (
    MarketStructure,
    SupportResistance,
    SwingDetector,
    SwingKind,
    SwingPoint,
    Trend,
)
from tests.helpers import KEY, random_bars


def test_swing_confirmed_only_after_k_bars() -> None:
    """Le pivot à l'index 3 n'est connu qu'à l'index 3 + k : pas de look-ahead."""
    highs = [1, 2, 3, 10, 3, 2, 1]
    det = SwingDetector(k=3)
    found: list[SwingPoint] = []
    for i, h in enumerate(highs):
        pts = det.update(i, float(h), float(h) - 0.5)
        found += [p for p in pts if p.kind is SwingKind.HIGH]
        if i < 6:
            assert not [p for p in found if p.price == 10.0]
    assert found[0].price == 10.0
    assert found[0].time_ms == 3 and found[0].confirmed_ms == 6


def test_market_structure_trend() -> None:
    ms = MarketStructure()
    for kind, price in [("high", 10), ("low", 5), ("high", 12), ("low", 7)]:
        ms.add(SwingPoint(SwingKind(kind), float(price), 0, 0))
    assert ms.trend is Trend.UP
    ms.add(SwingPoint(SwingKind.HIGH, 11.0, 0, 0))
    ms.add(SwingPoint(SwingKind.LOW, 6.0, 0, 0))
    assert ms.trend is Trend.DOWN


def test_support_resistance_clusters_and_nearest() -> None:
    sr = SupportResistance(tol_pct=0.5)
    for p, t in [(100.0, 1), (100.3, 2), (110.0, 3), (90.0, 4)]:
        sr.add(SwingPoint(SwingKind.HIGH, p, t, t))
    assert len(sr.levels) == 3
    lvl100 = next(lv for lv in sr.levels if 99 < lv.price < 101)
    assert lvl100.touches == 2
    sup, res = sr.nearest(105.0)
    assert sup is not None and res is not None
    assert sup.price == pytest.approx(100.15) and res.price == 110.0


def _engine() -> IndicatorEngine:
    return IndicatorEngine(KEY, IndicatorConfig())


def test_engine_ready_after_warmup_and_ignores_duplicates() -> None:
    bars = random_bars(400)
    eng = _engine()
    snaps = [eng.update(b) for b in bars]
    assert snaps[150] is not None and not snaps[150].ready  # EMA 200 pas encore chaude
    assert snaps[-1] is not None and snaps[-1].ready
    assert eng.update(bars[-1]) is None  # doublon ignoré
    assert eng.bars_seen == 400


def test_engine_detects_gap() -> None:
    bars = random_bars(10)
    eng = _engine()
    for b in bars[:5]:
        eng.update(b)
    with pytest.raises(GapDetected) as exc:
        eng.update(bars[7])
    assert exc.value.expected_ms == bars[5].open_time_ms


def test_engine_rejects_open_bar_in_update() -> None:
    b = random_bars(1)[0]
    open_bar = Bar(
        b.key,
        b.open_time_ms,
        b.close_time_ms,
        b.open,
        b.high,
        b.low,
        b.close,
        b.volume,
        closed=False,
    )
    with pytest.raises(ValueError):
        _engine().update(open_bar)


def test_no_lookahead_truncation_invariance() -> None:
    """Les valeurs à t ne doivent pas dépendre des bougies après t.
    On calcule sur 600 bougies et sur les 450 premières : les snapshots jusqu'à 450 sont
    identiques (y compris pivots et S/R)."""
    bars = random_bars(600, seed=7)
    full, part = _engine(), _engine()
    s_full = [full.update(b) for b in bars]
    s_part = [part.update(b) for b in bars[:450]]
    assert s_full[:450] == s_part


def test_preview_does_not_mutate_engine() -> None:
    bars = random_bars(300)
    a, b = _engine(), _engine()
    for bar in bars[:-1]:
        a.update(bar)
        b.update(bar)
    last = bars[-1]
    open_bar = Bar(
        last.key,
        last.open_time_ms,
        last.close_time_ms,
        last.open,
        last.high,
        last.low,
        last.close,
        last.volume,
        closed=False,
    )
    for _ in range(5):
        prev = a.preview(open_bar)
    committed = b.update(last)
    assert committed is not None
    assert prev.rsi == pytest.approx(committed.rsi)
    assert prev.ema == pytest.approx(committed.ema)
    assert a.update(last) == committed  # l'état de `a` n'a pas été altéré par les previews
