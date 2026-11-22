"""Chaque indicateur incrémental est comparé à une implémentation de référence pandas
(calcul vectorisé sur toute la série). Si le calcul incrémental dérive, ces tests cassent."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from sentinel.indicators.moving import EMA, SMA, Highest, Lowest
from sentinel.indicators.oscillators import MACD, RSI
from sentinel.indicators.volatility import ATR, Bollinger
from sentinel.indicators.volume import RelativeVolume, SessionVWAP
from tests.helpers import random_bars

N = 3000
BARS = random_bars(N, seed=42)
DF = pd.DataFrame(
    {
        "t": [b.open_time_ms for b in BARS],
        "o": [b.open for b in BARS],
        "h": [b.high for b in BARS],
        "l": [b.low for b in BARS],
        "c": [b.close for b in BARS],
        "v": [b.volume for b in BARS],
    }
)
RTOL = 1e-9


def _seeded_ewm(s: pd.Series, period: int, alpha: float) -> pd.Series:
    """Référence : lissage exponentiel amorcé par la SMA des `period` premières valeurs."""
    out = pd.Series(np.nan, index=s.index)
    seed = s.iloc[:period].mean()
    tail = pd.concat([pd.Series([seed]), s.iloc[period:].reset_index(drop=True)])
    ew = tail.ewm(alpha=alpha, adjust=False).mean().to_numpy()
    out.iloc[period - 1 :] = ew
    return out


def _assert_close(got: list[float | None], ref: pd.Series) -> None:
    ref_arr = ref.to_numpy()
    for i, (g, r) in enumerate(zip(got, ref_arr, strict=True)):
        if isinstance(r, float) and math.isnan(r):
            assert g is None, f"index {i}: attendu None (échauffement), obtenu {g}"
        else:
            assert g is not None, f"index {i}: None inattendu"
            assert g == pytest.approx(r, rel=RTOL, abs=1e-9), f"index {i}"


@pytest.mark.parametrize("period", [5, 20, 200])
def test_sma_matches_pandas(period: int) -> None:
    ind = SMA(period)
    _assert_close([ind.update(x) for x in DF.c], DF.c.rolling(period).mean())


@pytest.mark.parametrize("period", [9, 20, 50, 200])
def test_ema_matches_pandas(period: int) -> None:
    ind = EMA(period)
    _assert_close([ind.update(x) for x in DF.c], _seeded_ewm(DF.c, period, 2 / (period + 1)))


def test_rsi_matches_pandas() -> None:
    p = 14
    delta = DF.c.diff()
    gain = _seeded_ewm(delta.clip(lower=0).iloc[1:].reset_index(drop=True), p, 1 / p)
    loss = _seeded_ewm((-delta).clip(lower=0).iloc[1:].reset_index(drop=True), p, 1 / p)
    ref = pd.concat([pd.Series([np.nan]), 100 - 100 / (1 + gain / loss)]).reset_index(drop=True)
    ind = RSI(p)
    _assert_close([ind.update(x) for x in DF.c], ref)


def test_macd_matches_pandas() -> None:
    fast = _seeded_ewm(DF.c, 12, 2 / 13)
    slow = _seeded_ewm(DF.c, 26, 2 / 27)
    macd = fast - slow
    sig = pd.Series(np.nan, index=DF.index)
    sig.iloc[25:] = _seeded_ewm(macd.iloc[25:].reset_index(drop=True), 9, 2 / 10).to_numpy()
    ind = MACD(12, 26, 9)
    vals = [ind.update(x) for x in DF.c]
    _assert_close([v.macd if v else None for v in vals], macd)
    _assert_close([v.signal if v else None for v in vals], sig)
    _assert_close([v.hist if v else None for v in vals], macd - sig)


def test_atr_matches_pandas() -> None:
    p = 14
    prev_c = DF.c.shift(1)
    tr = pd.concat([DF.h - DF.l, (DF.h - prev_c).abs(), (DF.l - prev_c).abs()], axis=1).max(axis=1)
    tr.iloc[0] = DF.h.iloc[0] - DF.l.iloc[0]
    ind = ATR(p)
    _assert_close(
        [ind.update(h, lo, c) for h, lo, c in zip(DF.h, DF.l, DF.c, strict=True)],
        _seeded_ewm(tr, p, 1 / p),
    )


def test_bollinger_matches_pandas() -> None:
    ind = Bollinger(20, 2.0)
    vals = [ind.update(x) for x in DF.c]
    mid = DF.c.rolling(20).mean()
    std = DF.c.rolling(20).std(ddof=0)
    _assert_close([v.mid if v else None for v in vals], mid)
    # l'écart-type passe par une racine carrée : tolérance absolue relative au prix
    for v, s in zip(vals[19:], std.iloc[19:], strict=True):
        assert v is not None
        assert v.std == pytest.approx(s, rel=1e-6, abs=1e-6)
        assert v.upper == pytest.approx(v.mid + 2 * s, rel=1e-9)


def test_bollinger_stays_accurate_on_large_drifting_prices() -> None:
    """Prix de 10 000 à 200 000 : sans recentrage, Σx² perdrait en précision."""
    prices = np.geomspace(10_000, 200_000, 20_000) * (1 + 0.001 * np.sin(np.arange(20_000)))
    ind = Bollinger(20, 2.0)
    for x in prices:
        last = ind.update(float(x))
    assert last is not None
    ref = float(np.std(prices[-20:]))
    assert last.std == pytest.approx(ref, rel=1e-6)


def test_vwap_resets_daily() -> None:
    ind = SessionVWAP()
    tp = (DF.h + DF.l + DF.c) / 3
    day = DF.t // 86_400_000
    ref = (tp * DF.v).groupby(day).cumsum() / DF.v.groupby(day).cumsum()
    got = [
        ind.update(t, h, lo, c, v)
        for t, h, lo, c, v in zip(DF.t, DF.h, DF.l, DF.c, DF.v, strict=True)
    ]
    _assert_close(got, ref)  # type: ignore[arg-type]


def test_relative_volume_excludes_current_bar() -> None:
    ind = RelativeVolume(20)
    ref = DF.v / DF.v.shift(1).rolling(20).mean()
    _assert_close([ind.update(v) for v in DF.v], ref)


@pytest.mark.parametrize("period", [1, 5, 20])
def test_highest_lowest_match_pandas(period: int) -> None:
    hi, lo = Highest(period), Lowest(period)
    _assert_close([hi.update(x) for x in DF.h], DF.h.rolling(period).max())
    _assert_close([lo.update(x) for x in DF.l], DF.l.rolling(period).min())


# --- preview() : doit renvoyer EXACTEMENT ce que update() renverrait, sans muter l'état ---
floats = st.floats(min_value=1.0, max_value=1e6, allow_nan=False, allow_infinity=False)


@settings(max_examples=200, deadline=None)
@given(st.lists(floats, min_size=1, max_size=80), floats, st.integers(min_value=1, max_value=30))
def test_preview_equals_update_and_is_pure(xs: list[float], x_next: float, period: int) -> None:
    makers = [
        lambda: SMA(period),
        lambda: EMA(period),
        lambda: RSI(period),
        lambda: Highest(period),
        lambda: Lowest(period),
        lambda: Bollinger(max(period, 2)),
        lambda: RelativeVolume(period),
    ]
    for make in makers:
        a, b = make(), make()
        for x in xs:
            a.update(x)
            b.update(x)
        p1 = a.preview(x_next)
        p2 = a.preview(x_next)  # appel répété : aucun effet de bord
        assert p1 == p2
        expected = b.update(x_next)
        if expected is None or p1 is None:
            assert expected is None and p1 is None, type(a).__name__
        elif isinstance(expected, float):
            assert isinstance(p1, float)
            assert p1 == pytest.approx(expected, rel=1e-9, abs=1e-9), type(a).__name__
        else:
            assert p1 == pytest.approx(expected) or p1 == expected  # type: ignore[comparison-overlap]


def test_macd_and_atr_preview_equal_update() -> None:
    m1, m2, a1, a2 = MACD(), MACD(), ATR(), ATR()
    for b in BARS[:300]:
        for m in (m1, m2):
            m.update(b.close)
        for a in (a1, a2):
            a.update(b.high, b.low, b.close)
    nb = BARS[300]
    assert m1.preview(nb.close) == m2.update(nb.close)
    assert a1.preview(nb.high, nb.low, nb.close) == a2.update(nb.high, nb.low, nb.close)


def test_rsi_extremes() -> None:
    up = RSI(5)
    for x in range(1, 30):
        v = up.update(float(x))
    assert v == 100.0
    flat = RSI(5)
    for _ in range(30):
        v = flat.update(10.0)
    assert v == 50.0


def test_adx_matches_pandas() -> None:
    from sentinel.indicators.volatility import ADX

    p = 14
    h, lo, c = DF.h, DF.l, DF.c
    up, down = h.diff(), -lo.diff()
    pdm = up.where((up > down) & (up > 0), 0.0)
    mdm = down.where((down > up) & (down > 0), 0.0)
    prev_c = c.shift(1)
    tr = pd.concat([h - lo, (h - prev_c).abs(), (lo - prev_c).abs()], axis=1).max(axis=1)
    s = lambda x: _seeded_ewm(x.iloc[1:].reset_index(drop=True), p, 1 / p)
    str_, spdm, smdm = s(tr), s(pdm), s(mdm)
    pdi, mdi = 100 * spdm / str_, 100 * smdm / str_
    dx = (100 * (pdi - mdi).abs() / (pdi + mdi)).dropna().reset_index(drop=True)
    adx_tail = _seeded_ewm(dx, p, 1 / p)
    ref = pd.Series(np.nan, index=DF.index)
    first = 1 + (p - 1)  # premier DX disponible
    ref.iloc[first : first + len(adx_tail)] = adx_tail.to_numpy()
    ind = ADX(p)
    _assert_close([ind.update(a, b, x) for a, b, x in zip(h, lo, c, strict=True)], ref)


def test_percent_rank() -> None:
    from sentinel.indicators.volatility import PercentRank

    pr = PercentRank(100)
    vals = [pr.update(float(i)) for i in range(200)]
    assert vals[28] is None and vals[29] == 1.0  # nouveau maximum
    assert pr.update(-1.0) == pytest.approx(1 / 100)
