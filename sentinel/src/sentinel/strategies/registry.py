"""Construit les stratégies activées à partir de la config."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sentinel.core.config import StrategyEntry
from sentinel.strategies.base import Strategy
from sentinel.strategies.donchian import DonchianParams, DonchianTrend
from sentinel.strategies.mean_reversion import MeanReversionParams, RangeReversion
from sentinel.strategies.pullback import PullbackParams, TrendPullback

_REGISTRY: dict[str, tuple[Callable[[Any], Strategy], type[Any]]] = {
    DonchianTrend.name: (DonchianTrend, DonchianParams),
    TrendPullback.name: (TrendPullback, PullbackParams),
    RangeReversion.name: (RangeReversion, MeanReversionParams),
}


def strategy_factory(name: str, entry: StrategyEntry) -> Callable[[], Strategy]:
    if name not in _REGISTRY:
        raise ValueError(f"stratégie inconnue : {name}")
    cls, params_cls = _REGISTRY[name]
    params = params_cls(**{**entry.params, "allow_short": entry.allow_short})
    return lambda: cls(params)
