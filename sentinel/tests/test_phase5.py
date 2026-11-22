from __future__ import annotations

from dataclasses import replace

from sentinel.core.config import IndicatorConfig
from sentinel.core.models import Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine, IndicatorSnapshot
from sentinel.indicators.structure import Trend
from sentinel.regime.classifier import TrendRegime, VolRegime, classify
from sentinel.scoring.confluence import SmartMoneyView, confluence_score
from sentinel.strategies.base import Setup, Side
from sentinel.strategies.donchian import DonchianParams
from sentinel.strategies.mean_reversion import RangeReversion
from tests.helpers import random_bars

K = StreamKey(Market.SPOT, "BTCUSDT", Timeframe.D1)


def _snap() -> IndicatorSnapshot:
    eng = IndicatorEngine(K, IndicatorConfig())
    for b in random_bars(500, K, seed=5):
        s = eng.update(b)
    assert s is not None and s.adx is not None and s.vol_rank is not None
    return s


def test_regime_rules() -> None:
    s = _snap()
    up = replace(s, adx=30.0, close=110.0, ema={20: 105.0, 50: 100.0, 200: 90.0}, vol_rank=0.9)
    r = classify(up)
    assert r is not None and r.trend is TrendRegime.UP and r.vol is VolRegime.HIGH
    assert classify(replace(s, adx=15.0)).trend is TrendRegime.RANGE  # type: ignore[union-attr]
    down = replace(s, adx=30.0, close=80.0, ema={20: 85.0, 50: 90.0, 200: 100.0})
    assert classify(down).trend is TrendRegime.DOWN  # type: ignore[union-attr]
    assert classify(replace(s, adx=22.0)).trend is TrendRegime.TRANSITION  # type: ignore[union-attr]
    assert classify(replace(s, adx=None)) is None


def _setup(side: Side = Side.LONG) -> Setup:
    return Setup("x", side, 100.0, 90.0, float("inf"), 0.5, 1e9, 10**9, "t", 0)


def test_score_bounds_and_missing_components_excluded() -> None:
    s = _snap()
    r = classify(s)
    sc = confluence_score(_setup(), s, {Timeframe.D1: s}, r, "trend")
    assert 0 <= sc.total <= 100
    names = [c.name for c in sc.components]
    assert "Smart money" not in names  # pas de donnée → exclu, pas compté comme 0
    best = replace(
        s,
        relvol=2.5,
        rsi=60.0,
        adx=30.0,
        close=110.0,
        ema={20: 105.0, 50: 100.0, 200: 90.0},
        trend=Trend.UP,
        vol_rank=0.5,
    )
    best = replace(best, macd=replace(s.macd, hist=1.0) if s.macd else None)  # type: ignore[arg-type]
    top = confluence_score(
        _setup(), best, {Timeframe.D1: best, Timeframe.H4: best}, classify(best), "trend"
    )
    assert top.total == 100


def test_smart_money_component() -> None:
    s = _snap()
    with_sm = confluence_score(_setup(), s, {}, None, "trend", SmartMoneyView(3, 0, 5))
    against = confluence_score(_setup(), s, {}, None, "trend", SmartMoneyView(0, 3, 5))
    sm_for = next(c for c in with_sm.components if c.name == "Smart money")
    sm_against = next(c for c in against.components if c.name == "Smart money")
    assert sm_for.points == 15 and sm_against.points == 0


def test_mean_reversion_requires_range_regime() -> None:
    s = _snap()
    bb = s.bb
    assert bb is not None
    k4 = StreamKey(Market.SPOT, "BTCUSDT", Timeframe.H4)
    bar = random_bars(1, k4)[0]
    low_close = bb.lower * 0.99
    snap4 = replace(s, key=k4, close=low_close, rsi=20.0)
    bar = replace(bar, close=low_close)
    strat = RangeReversion()
    trending = replace(s, adx=35.0)
    assert strat.on_bar(snap4, {Timeframe.D1: trending}, bar) is None
    ranging = replace(s, adx=12.0)
    setup = strat.on_bar(snap4, {Timeframe.D1: ranging}, bar)
    if setup is not None:  # l'objectif doit valoir ≥ 0,5 R
        assert setup.side is Side.LONG and setup.tp1_r >= 0.5 and setup.tp1_frac == 1.0


def test_donchian_defaults_unchanged() -> None:
    p = DonchianParams()
    assert p.min_relvol == 0.0 and p.min_adx == 0.0  # la stratégie validée n'est pas modifiée


def test_live_stats_file_is_the_validated_strategy() -> None:
    """Les alertes citent reports/stats/donchian_trend.json : il doit décrire la stratégie
    validée (essai 2, sans filtre), pas une variante testée ensuite."""
    import json
    from pathlib import Path

    d = json.loads(
        Path(__file__).parents[1].joinpath("reports/stats/donchian_trend.json").read_text()
    )
    assert d["trial"] == 2
    assert "min_relvol=0.0" in d["params"] and "min_adx=0.0" in d["params"]
