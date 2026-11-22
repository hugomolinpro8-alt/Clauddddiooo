"""Fait tourner une stratégie validée en live, sur chaque (marché, symbole).

Points clés :
  - une instance de stratégie par (marché, symbole) : elle a un état (canaux, bougie
    précédente) qui ne doit pas se mélanger entre actifs ;
  - « position virtuelle » : comme dans le backtest, une seule position à la fois par actif.
    Tant que le stop (initial puis suiveur) n'est pas touché, un nouveau signal identique
    est ignoré. Sans cela, une tendance qui fait un nouveau plus haut chaque jour enverrait
    une alerte par jour — et le live ne ressemblerait plus au backtest ;
  - la chauffe (`warm`) rejoue l'historique avec EXACTEMENT la même logique, setups compris :
    au démarrage, l'état est celui qu'aurait le bot s'il avait tourné sans interruption ;
  - tout ce qui est calculé ici est en mémoire et rapide : le rapport n°2 et le graphique
    sont produits plus tard, hors chemin critique, à partir de l'`AlertContext` figé.
"""

from __future__ import annotations

import json
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from sentinel.core.config import RiskConfig
from sentinel.core.logging import get_logger
from sentinel.core.models import Bar, Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine, IndicatorSnapshot
from sentinel.pipeline.runner import Signal
from sentinel.risk.sizing import SizePlan, allowed_risk_pct, position_size
from sentinel.strategies.base import Setup, Side, Strategy

log = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class AssetStats:
    n: int
    win_rate: float
    expectancy_r: float
    oos_n: int
    oos_win_rate: float
    oos_expectancy_r: float
    avg_win_r: float
    avg_loss_r: float


def load_stats(stats_dir: Path, strategy: str) -> dict[str, AssetStats]:
    p = stats_dir / f"{strategy}.json"
    if not p.exists():
        log.warning("strategy_stats_missing", strategy=strategy, path=str(p))
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return {k: AssetStats(**v) for k, v in data.get("per_asset", {}).items()}


def load_reference_r(stats_dir: Path, strategy: str) -> dict[str, list[float]]:
    """{"<stratégie>:<marché>": [R des trades hors échantillon]} pour le test de divergence."""
    p = stats_dir / f"{strategy}.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return {
        f"{strategy}:{m}": list(v.get("oos_r", [])) for m, v in data.get("per_market", {}).items()
    }


@dataclass(frozen=True, slots=True)
class AlertContext:
    """Instantané figé au moment du signal : tout ce que le rapport et le graphique utilisent."""

    setup: Setup
    strategy_name: str
    strategy_label: str
    horizon: str
    profile_warnings: tuple[str, ...]
    exit_channel_level: float | None  # niveau actuel du stop suiveur (canal)
    bar: Bar
    snap: IndicatorSnapshot
    multi_tf: dict[Timeframe, IndicatorSnapshot | None]
    size: SizePlan
    stats: AssetStats | None
    history: tuple[Bar, ...]  # dernières bougies de l'UT de la stratégie, pour le graphique
    # autres positions virtuelles ouvertes au moment du signal (risque corrélé cumulé)
    other_positions: tuple[str, ...] = ()
    base_risk_pct: float = 0.5  # risque prévu par trade ; size.risk_pct peut être plus bas
    open_risk_pct: float = 0.0  # risque déjà ouvert (paper) au moment du signal
    max_open_risk_pct: float = 1.5


@dataclass(slots=True)
class VirtualPosition:
    side: Side
    stop: float
    channel: int
    opened_ms: int


class StrategyDetector:
    def __init__(
        self,
        make_strategy: Callable[[], Strategy],
        markets: Sequence[Market],
        engines: Mapping[StreamKey, IndicatorEngine],
        risk: RiskConfig,
        stats: Mapping[str, AssetStats],
        format_alert: Callable[[AlertContext], str],
        history_len: int = 400,  # ≥ 200 pour tracer l'EMA200 sur le graphique
        open_risk_pct: Callable[[], float] | None = None,
    ) -> None:
        proto = make_strategy()
        self.name = proto.name
        self._proto = proto
        self._make = make_strategy
        self.markets = set(markets)
        self.engines = engines
        self.risk = risk
        self.stats = stats
        self.format_alert = format_alert
        self._strats: dict[tuple[Market, str], Strategy] = {}
        self._history: dict[tuple[Market, str], deque[Bar]] = {}
        self.positions: dict[tuple[Market, str], VirtualPosition] = {}
        self._history_len = history_len
        self._open_risk_pct = open_risk_pct or (lambda: 0.0)

    def _accepts(self, bar: Bar) -> bool:
        return bar.key.market in self.markets and bar.key.timeframe is self._proto.timeframe

    def _ctx(self, bar: Bar, tfs: Sequence[Timeframe]) -> dict[Timeframe, IndicatorSnapshot | None]:
        out: dict[Timeframe, IndicatorSnapshot | None] = {}
        for tf in tfs:
            eng = self.engines.get(StreamKey(bar.key.market, bar.key.symbol, tf))
            out[tf] = eng.last if eng else None
        return out

    def _step(self, snap: IndicatorSnapshot, bar: Bar) -> Setup | None:
        """Logique commune chauffe/live : met à jour la position virtuelle et la stratégie."""
        k = (bar.key.market, bar.key.symbol)
        strat = self._strats.get(k)
        if strat is None:
            strat = self._strats[k] = self._make()
            self._history[k] = deque(maxlen=self._history_len)
        hist = self._history[k]
        hist.append(bar)
        pos = self.positions.get(k)
        if pos is not None:
            hit = bar.low <= pos.stop if pos.side is Side.LONG else bar.high >= pos.stop
            if hit:
                log.info(
                    "virtual_position_closed",
                    strategy=self.name,
                    stream=str(bar.key),
                    stop=pos.stop,
                )
                del self.positions[k]
                pos = None
            elif pos.channel and len(hist) >= pos.channel:
                window = list(hist)[-pos.channel :]
                if pos.side is Side.LONG:
                    pos.stop = max(pos.stop, min(b.low for b in window))
                else:
                    pos.stop = min(pos.stop, max(b.high for b in window))
        setup = strat.on_bar(snap, self._ctx(bar, strat.context), bar)
        if setup is None or pos is not None:
            return None
        self.positions[k] = VirtualPosition(
            setup.side, setup.stop, setup.exit_channel, bar.close_time_ms
        )
        return setup

    def warm(self, snap: IndicatorSnapshot, bar: Bar) -> None:
        if self._accepts(bar):
            self._step(snap, bar)

    def channel_level(self, market: Market, symbol: str, side: Side, n: int) -> float | None:
        hist = self._history.get((market, symbol))
        if not n or hist is None or len(hist) < n:
            return None
        window = list(hist)[-n:]
        return min(b.low for b in window) if side is Side.LONG else max(b.high for b in window)

    def evaluate(self, snap: IndicatorSnapshot, bar: Bar) -> Signal | None:
        if not self._accepts(bar):
            return None
        setup = self._step(snap, bar)
        if setup is None:
            return None
        k = (bar.key.market, bar.key.symbol)
        others = tuple(
            f"{sym} {p.side.name.lower()} ({m})"
            for (m, sym), p in self.positions.items()
            if (m, sym) != k
        )
        open_pct = self._open_risk_pct()
        risk_pct = allowed_risk_pct(
            self.risk.risk_per_trade_pct, self.risk.max_open_risk_pct, open_pct
        )
        try:
            size = position_size(
                self.risk.capital_eur,
                risk_pct,
                setup.signal_close,
                setup.stop,
                bar.key.market,
            )
        except ValueError:
            log.error("sizing_failed", stream=str(bar.key), stop=setup.stop)
            return None
        ctx = AlertContext(
            setup=setup,
            strategy_name=self.name,
            strategy_label=self._proto.label,
            horizon=self._proto.horizon,
            profile_warnings=self._proto.profile_warnings,
            exit_channel_level=self.channel_level(*k, setup.side, setup.exit_channel),
            bar=bar,
            snap=snap,
            multi_tf=self._ctx(bar, [tf for tf in Timeframe if tf.seconds >= 900]),
            size=size,
            stats=self.stats.get(f"{bar.key.market.value}:{bar.key.symbol}"),
            history=tuple(self._history[k]),
            other_positions=others,
            base_risk_pct=self.risk.risk_per_trade_pct,
            open_risk_pct=open_pct,
            max_open_risk_pct=self.risk.max_open_risk_pct,
        )
        return Signal(bar.key, self.name, self.format_alert(ctx), bar, snap, payload=ctx)

    def open_positions(self) -> dict[tuple[Market, str], VirtualPosition]:
        return dict(self.positions)
