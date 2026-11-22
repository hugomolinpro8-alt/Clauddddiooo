"""Backtest événementiel : rejoue l'historique dans les MÊMES IndicatorEngine et stratégies
que le live, bougie par bougie, dans l'ordre chronologique. La mécanique des positions est
dans `position.py`, partagée avec le paper trading.

Résultat en multiples de R (R = risque initial = |entrée − stop|), ce qui rend les trades
comparables entre actifs et indépendants du capital.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Mapping, Sequence

from sentinel.backtest.costs import CostModel
from sentinel.backtest.position import OpenPosition, PositionEngine, Trade
from sentinel.core.config import IndicatorConfig
from sentinel.core.models import Bar, Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine, IndicatorSnapshot
from sentinel.strategies.base import Setup, Strategy

__all__ = ["Backtester", "Trade"]


class Backtester:
    def __init__(
        self,
        strategy_factory: Callable[[], Strategy],
        costs: CostModel,
        indicator_cfg: IndicatorConfig | None = None,
    ) -> None:
        self.strategy_factory = strategy_factory
        self.costs = costs
        self.pe = PositionEngine(costs)
        self.icfg = indicator_cfg or IndicatorConfig()

    def run(
        self,
        symbol: str,
        market: Market,
        bars: Mapping[Timeframe, Sequence[Bar]],
        funding: Sequence[tuple[int, float]] = (),
        start_ms: int | None = None,
        end_ms: int | None = None,
    ) -> list[Trade]:
        """Les bougies avant `start_ms` servent à chauffer les indicateurs (aucun trade)."""
        strat = self.strategy_factory()
        main_tf = strat.timeframe
        engines = {
            tf: IndicatorEngine(StreamKey(market, symbol, tf), self.icfg, strict_gaps=False)
            for tf in (main_tf, *strat.context)
        }
        # Fusion chronologique par heure de CLÔTURE ; à égalité, le contexte (UT supérieure)
        # passe d'abord : la bougie journalière de 23:59 est connue en même temps que la 4h.
        order = {tf: i for i, tf in enumerate(sorted(engines, key=lambda t: -t.seconds))}
        events = sorted(
            ((b.close_time_ms, order[tf], tf, b) for tf in engines for b in bars.get(tf, ())),
            key=lambda e: (e[0], e[1]),
        )
        f_times = [t for t, _ in funding]
        f_rates = [r for _, r in funding]

        trades: list[Trade] = []
        pending: Setup | None = None
        pos: OpenPosition | None = None
        prev_close_ms = 0
        last_bar: Bar | None = None
        recent: deque[tuple[float, float]] = deque(maxlen=500)  # (high, low) bougies principales

        for _, _, tf, bar in events:
            if end_ms is not None and bar.open_time_ms >= end_ms:
                break
            if tf is not main_tf:
                engines[tf].update(bar)
                continue
            in_window = start_ms is None or bar.open_time_ms >= start_ms
            if pending is not None and pos is None:
                pos = self.pe.open(pending, bar, symbol, market)
                pending = None
            if pos is not None:
                if self.costs.funding and f_times:
                    self.pe.apply_funding(pos, bar, prev_close_ms, f_times, f_rates)
                if self.pe.step(pos, bar):
                    trades.append(pos.t)
                    pos = None
            snap = engines[main_tf].update(bar)
            recent.append((bar.high, bar.low))
            if pos is not None and snap is not None and self.pe.after_close(pos, bar, snap, recent):
                trades.append(pos.t)
                pos = None
            ctx: dict[Timeframe, IndicatorSnapshot | None] = {
                t: engines[t].last for t in strat.context
            }
            setup = strat.on_bar(snap, ctx, bar) if snap is not None else None
            if setup is not None and pos is None and in_window:
                pending = setup
            prev_close_ms = bar.close_time_ms
            last_bar = bar

        if pos is not None and last_bar is not None:  # fin des données : sortie forcée
            self.pe.exit(
                pos,
                last_bar.close,
                last_bar.close_time_ms,
                pos.size,
                "fin_donnees",
                self.costs.taker_fee,
                self.costs.slippage,
            )
            self.pe.finalize(pos)
            trades.append(pos.t)
        return trades
