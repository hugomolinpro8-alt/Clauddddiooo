"""Le backtester est testé sur des scénarios construits à la main, dont le résultat exact
se calcule sur papier. Si ces tests passent, les chiffres du rapport reposent sur une
mécanique vérifiée — pas sur une boîte noire."""

from __future__ import annotations

import numpy as np
import pytest

from sentinel.backtest.costs import CostModel
from sentinel.backtest.engine import Backtester, Trade
from sentinel.backtest.metrics import portfolio_equity, trade_stats
from sentinel.core.models import Bar, Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.strategies.base import Setup, Side
from sentinel.strategies.pullback import PullbackParams, TrendPullback
from tests.helpers import random_bars

H4 = 14_400_000
K = StreamKey(Market.SPOT, "TESTUSDT", Timeframe.H4)


def bars_from(ohlc: list[tuple[float, float, float, float]], t0: int = 0) -> list[Bar]:
    return [
        Bar(K, t0 + i * H4, t0 + (i + 1) * H4 - 1, o, h, lo, c, 1.0, True)
        for i, (o, h, lo, c) in enumerate(ohlc)
    ]


class Scripted:
    """Émet un setup unique à la clôture de la bougie `at`."""

    name = "scripted"
    timeframe = Timeframe.H4
    context: tuple[Timeframe, ...] = ()

    def __init__(
        self,
        at: int,
        side: Side,
        stop: float,
        tp1_r: float = 2.0,
        time_stop: int = 100,
        trail_atr: float = 1e9,
    ) -> None:
        self.at, self.side, self.stop = at, side, stop
        self.tp1_r, self.time_stop, self.trail = tp1_r, time_stop, trail_atr
        self.i = -1

    def on_bar(self, snap: IndicatorSnapshot, ctx: object, bar: Bar) -> Setup | None:
        self.i += 1
        if self.i != self.at:
            return None
        return Setup(
            self.name,
            self.side,
            bar.close,
            self.stop,
            self.tp1_r,
            0.5,
            self.trail,
            self.time_stop,
            "test",
            bar.close_time_ms,
        )


def run(
    strategy: Scripted,
    ohlc: list[tuple[float, float, float, float]],
    costs: CostModel | None = None,
    funding: list[tuple[int, float]] | None = None,
) -> list[Trade]:
    bt = Backtester(lambda: strategy, costs or CostModel.zero())
    return bt.run("TESTUSDT", Market.SPOT, {Timeframe.H4: bars_from(ohlc)}, funding or [])


FLAT = (100.0, 100.5, 99.5, 100.0)


def test_entry_next_open_and_stop_is_minus_one_r() -> None:
    ohlc = [FLAT, FLAT, (101, 101, 100, 100.5), (100.5, 100.6, 94, 95)]
    (t,) = run(Scripted(1, Side.LONG, stop=96.0), ohlc)
    assert t.entry == 101.0  # ouverture de la bougie SUIVANT le signal, pas le close du signal
    assert t.risk == 5.0
    assert t.r_net == pytest.approx(-1.0) and t.exit_reason == "stop"


def test_tp1_then_breakeven() -> None:
    ohlc = [FLAT, FLAT, (100, 100.2, 99.8, 100), (100, 110.5, 100, 109), (109, 109, 99, 99.5)]
    (t,) = run(Scripted(1, Side.LONG, stop=95.0), ohlc)
    # +2R sur 50 %, puis point mort sur 50 % → +1,0 R
    assert t.tp1_hit and t.exit_reason == "stop_point_mort"
    assert t.r_net == pytest.approx(1.0)


def test_same_bar_stop_and_target_assumes_stop_first() -> None:
    ohlc = [FLAT, FLAT, (100, 100.2, 99.8, 100), (100, 111, 94, 105)]
    (t,) = run(Scripted(1, Side.LONG, stop=95.0), ohlc)
    assert t.r_net == pytest.approx(-1.0) and not t.tp1_hit


def test_gap_through_stop_exits_at_open_worse_than_minus_one() -> None:
    ohlc = [FLAT, FLAT, (100, 100.2, 99.8, 100), (90, 91, 89, 90)]
    (t,) = run(Scripted(1, Side.LONG, stop=95.0), ohlc)
    assert t.r_net == pytest.approx(-2.0)  # (90 − 100) / 5


def test_short_mirror() -> None:
    ohlc = [FLAT, FLAT, (100, 100.2, 99.8, 100), (100, 100, 89.5, 91)]
    (t,) = run(Scripted(1, Side.SHORT, stop=105.0), ohlc)
    assert t.tp1_hit and t.tp1 == 90.0


def test_costs_exact() -> None:
    """Long 100 → stop 95 avec taker 0,1 %, slippage 0,05 % (×2 sur stop)."""
    c = CostModel(taker_fee=0.001, maker_fee=0.001, slippage=0.0005)
    ohlc = [FLAT, FLAT, (100, 100.2, 99.8, 100), (99, 99, 90, 92)]
    (t,) = run(Scripted(1, Side.LONG, stop=95.0), ohlc, c)
    entry = 100 * 1.0005
    risk = entry - 95
    exit_fill = 95 * (1 - 0.001)
    expected = (exit_fill - entry - 0.001 * entry - 0.001 * exit_fill) / risk
    assert t.entry == pytest.approx(entry)
    assert t.r_net == pytest.approx(expected)
    assert t.r_gross == pytest.approx((95 - entry) / risk)


def test_time_stop() -> None:
    ohlc = [FLAT, FLAT] + [FLAT] * 10
    (t,) = run(Scripted(1, Side.LONG, stop=95.0, time_stop=3), ohlc)
    assert t.exit_reason == "temps" and t.bars_held == 3


def test_funding_long_pays_positive_rate() -> None:
    c = CostModel(0, 0, 0, funding=True)
    ohlc = [FLAT, FLAT, FLAT, FLAT, FLAT]
    funding = [(3 * H4 + 1000, 0.001)]  # pendant la bougie 3, position ouverte
    (t,) = run(Scripted(1, Side.LONG, stop=95.0), ohlc, c, funding)
    assert t.funding_r == pytest.approx(-0.001 * 100 / 5)


def test_trades_unchanged_by_future_data() -> None:
    """Anti look-ahead : couper les données après t ne change aucun trade clôturé avant t."""
    bars4 = random_bars(3000, StreamKey(Market.SPOT, "X", Timeframe.H4), seed=3)
    bars1d = random_bars(
        500, StreamKey(Market.SPOT, "X", Timeframe.D1), seed=4, start_ms=bars4[0].open_time_ms
    )
    p = PullbackParams()
    bt = Backtester(lambda: TrendPullback(p), CostModel.for_market(Market.SPOT))
    full = bt.run("X", Market.SPOT, {Timeframe.H4: bars4, Timeframe.D1: bars1d})
    cut_ms = bars4[2000].open_time_ms
    part = bt.run(
        "X",
        Market.SPOT,
        {Timeframe.H4: bars4[:2000], Timeframe.D1: [b for b in bars1d if b.close_time_ms < cut_ms]},
    )
    done = [t for t in full if t.exit_ms < bars4[1999].close_time_ms]
    assert len(done) > 0
    assert [(t.entry_ms, t.r_net) for t in done] == [
        (t.entry_ms, t.r_net) for t in part[: len(done)]
    ]


def test_portfolio_single_trade_compounding() -> None:
    t = Trade(
        "A",
        Market.SPOT,
        "s",
        Side.LONG,
        0,
        86_400_000,
        100,
        98,
        2,
        104,
        exit_ms=3 * 86_400_000,
        r_net=2.0,
    )
    _grid, eq, taken, _ = portfolio_equity([t], 0, 5 * 86_400_000, risk_pct=0.005)
    assert taken == [t]
    assert eq[-1] == pytest.approx(1.01)  # +2R × 0,5 % = +1 %


def test_portfolio_caps_correlated_risk() -> None:
    mk = lambda s: Trade(
        s,
        Market.SPOT,
        "s",
        Side.LONG,
        0,
        86_400_000,
        100,
        98,
        2,
        104,
        exit_ms=3 * 86_400_000,
        r_net=-1.0,
    )
    trades = [mk(s) for s in "ABCDE"]
    _, eq, taken, _ = portfolio_equity(
        trades, 0, 5 * 86_400_000, risk_pct=0.005, max_open_risk_pct=0.015, max_gross_leverage=10
    )
    assert len(taken) == 3  # au plus 1,5 % de risque ouvert simultanément
    assert eq[-1] == pytest.approx(1 - 0.015)


def test_trade_stats() -> None:
    mk = lambda r: Trade("A", Market.SPOT, "s", Side.LONG, 0, 0, 1, 0.9, 0.1, 1.2, r_net=r)
    s = trade_stats([mk(2.0), mk(-1.0), mk(-1.0), mk(3.0)])
    assert s.n == 4 and s.win_rate == 0.5
    assert s.expectancy_r == pytest.approx(0.75)
    assert s.profit_factor == pytest.approx(2.5)
    assert np.isfinite(s.exp_ci_low)


# --- Sortie par canal + stratégie Donchian ------------------------------------------------
def test_channel_exit_trails_up_and_exits() -> None:
    """Long 100, stop initial 90, canal 2 bougies : le stop remonte au plus bas des 2
    dernières bougies, puis la position sort quand ce plus bas est cassé."""
    from dataclasses import replace

    class Chan(Scripted):
        def on_bar(self, snap: IndicatorSnapshot, ctx: object, bar: Bar) -> Setup | None:
            s = super().on_bar(snap, ctx, bar)
            return None if s is None else replace(s, tp1_r=float("inf"), exit_channel=2)

    ohlc = [
        FLAT,
        FLAT,
        (100, 104, 99, 103),
        (103, 108, 102, 107),
        (107, 109, 106, 108),
        (108, 108, 101, 102),
    ]
    (t,) = run(Chan(1, Side.LONG, stop=90.0), ohlc)
    # après la bougie 4 : canal = min(102, 106) = 102 → bougie 5 touche 101 → sortie à 102
    assert t.exit_reason == "stop_suiveur"
    assert t.r_net == pytest.approx((102 - 100) / 10)


def test_donchian_breakout_excludes_current_bar() -> None:
    from sentinel.core.config import IndicatorConfig
    from sentinel.indicators.engine import IndicatorEngine
    from sentinel.strategies.donchian import DonchianParams, DonchianTrend

    key = StreamKey(Market.SPOT, "X", Timeframe.D1)
    strat = DonchianTrend(DonchianParams(entry_n=3, stop_atr=2.0))
    eng = IndicatorEngine(key, IndicatorConfig())
    day = 86_400_000
    setups = []
    seq = [(10, 11, 9, 10)] * 20 + [(10, 11, 9, 10.9), (10.9, 12, 10.5, 11.8)]
    for i, (o, h, lo, c) in enumerate(seq):
        b = Bar(key, i * day, (i + 1) * day - 1, o, h, lo, c, 1.0, True)
        snap = eng.update(b)
        assert snap is not None
        setups.append(strat.on_bar(snap, {}, b))
    assert setups[-2] is None  # 10,9 < plus haut précédent 11 : pas de cassure
    s = setups[-1]
    assert s is not None and s.side is Side.LONG and s.exit_channel == 20
    assert s.stop == pytest.approx(11.8 - 2.0 * eng.last.atr)  # type: ignore[union-attr]
