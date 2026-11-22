"""Mécanique d'une position : ouverture, stops, objectif, stop suiveur, funding, sortie.

Ce module est PARTAGÉ par le backtest et le paper trading. C'est volontaire : si le paper
trading avait sa propre implémentation, un écart entre paper et backtest pourrait venir
d'une différence de code plutôt que du marché. Ici, l'écart ne peut venir que du marché.

Hypothèses d'exécution (toutes défavorables quand il y a un doute) :
  - entrée à l'OUVERTURE de la bougie qui suit le signal (+ slippage) ;
  - si l'ouverture est déjà au-delà du stop → trade annulé (on ne poursuit pas le prix) ;
  - stop et TP1 touchés dans la même bougie → on suppose que le STOP est passé en premier ;
  - ouverture au-delà du stop (gap) → sortie au prix d'ouverture, pas au stop ;
  - stops, sorties temporelles et suiveuses : taker + slippage ×2 (stops) ;
  - TP1 : ordre limite → frais maker, pas de slippage ;
  - perps : funding réel payé/reçu toutes les 8 h sur la taille restante ;
  - les stops suiveurs sont recalculés à la clôture et s'appliquent à la bougie suivante.
"""

from __future__ import annotations

import bisect
from collections import deque
from dataclasses import dataclass, field

from sentinel.backtest.costs import CostModel
from sentinel.core.models import Bar, Market
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.strategies.base import Setup, Side


@dataclass(slots=True)
class Trade:
    symbol: str
    market: Market
    strategy: str
    side: Side
    signal_ms: int
    entry_ms: int
    entry: float
    stop0: float
    risk: float  # en prix, par unité
    tp1: float
    exit_ms: int = 0
    r_net: float = 0.0  # résultat final net de frais/slippage/funding, en R
    r_gross: float = 0.0  # sans aucun coût (pour mesurer le poids des frais)
    funding_r: float = 0.0
    exit_reason: str = ""
    bars_held: int = 0
    tp1_hit: bool = False
    path: list[tuple[int, float]] = field(default_factory=list)  # (temps, R latent net)

    @property
    def stop_pct(self) -> float:
        return self.risk / self.entry


@dataclass(slots=True)
class OpenPosition:
    t: Trade
    setup: Setup
    stop: float
    size: float = 1.0
    extreme: float = 0.0  # plus haut (long) / plus bas (short) depuis l'entrée
    realized_net: float = 0.0
    realized_gross: float = 0.0


class PositionEngine:
    def __init__(self, costs: CostModel) -> None:
        self.costs = costs

    def open(self, s: Setup, bar: Bar, symbol: str, market: Market) -> OpenPosition | None:
        side = s.side
        fill = bar.open * (1 + side * self.costs.slippage)
        risk = side * (fill - s.stop)
        if risk <= 0:
            return None  # le prix a déjà dépassé l'invalidation à l'ouverture
        t = Trade(
            symbol,
            market,
            s.strategy,
            side,
            s.time_ms,
            bar.open_time_ms,
            fill,
            s.stop,
            risk,
            fill + side * s.tp1_r * risk,
        )
        pos = OpenPosition(t, s, s.stop, extreme=fill)
        pos.realized_net -= self.costs.taker_fee * fill / risk
        return pos

    def exit(
        self,
        pos: OpenPosition,
        price: float,
        t_ms: int,
        frac: float,
        reason: str,
        fee: float,
        slip: float,
    ) -> None:
        tr, side = pos.t, pos.t.side
        fill = price * (1 - side * slip)
        pos.realized_gross += frac * side * (price - tr.entry) / tr.risk
        pos.realized_net += frac * (side * (fill - tr.entry) - fee * fill) / tr.risk
        pos.size -= frac
        tr.exit_ms = t_ms
        tr.exit_reason = reason

    def finalize(self, pos: OpenPosition) -> None:
        pos.t.r_net = pos.realized_net
        pos.t.r_gross = pos.realized_gross

    def step(self, pos: OpenPosition, bar: Bar) -> bool:
        """Sorties intrabar (stop, TP1). Renvoie True si la position est entièrement fermée."""
        tr, side, c = pos.t, pos.t.side, self.costs
        tr.bars_held += 1
        # 1) stop, y compris gap d'ouverture — vérifié EN PREMIER (hypothèse défavorable)
        gap = bar.open <= pos.stop if side is Side.LONG else bar.open >= pos.stop
        touched = bar.low <= pos.stop if side is Side.LONG else bar.high >= pos.stop
        if gap or touched:
            px = bar.open if gap else pos.stop
            if tr.tp1_hit and pos.stop == tr.entry:
                reason = "stop_point_mort"
            elif tr.tp1_hit or side * (pos.stop - tr.stop0) > 0:
                reason = "stop_suiveur"  # stop remonté (suiveur ATR ou canal)
            else:
                reason = "stop"
            self.exit(pos, px, bar.close_time_ms, pos.size, reason, c.taker_fee, c.stop_slippage)
            self.finalize(pos)
            return True
        # 2) objectif 1 (ordre limite)
        hit_tp = bar.high >= tr.tp1 if side is Side.LONG else bar.low <= tr.tp1
        if not tr.tp1_hit and hit_tp:
            self.exit(pos, tr.tp1, bar.close_time_ms, pos.setup.tp1_frac, "tp1", c.maker_fee, 0.0)
            tr.tp1_hit = True
            pos.stop = tr.entry  # point mort
            if pos.size <= 1e-12:
                self.finalize(pos)
                return True
        return False

    def after_close(
        self,
        pos: OpenPosition,
        bar: Bar,
        snap: IndicatorSnapshot,
        recent: deque[tuple[float, float]],
    ) -> bool:
        """À la clôture : stops suiveurs, sortie temporelle, valorisation latente."""
        tr, side, c = pos.t, pos.t.side, self.costs
        n = pos.setup.exit_channel
        if n > 0 and len(recent) >= n:
            window = list(recent)[-n:]
            if side is Side.LONG:
                pos.stop = max(pos.stop, min(lo for _, lo in window))
            else:
                pos.stop = min(pos.stop, max(hi for hi, _ in window))
        if side is Side.LONG:
            pos.extreme = max(pos.extreme, bar.high)
        else:
            pos.extreme = min(pos.extreme, bar.low)
        if tr.tp1_hit and snap.atr:
            trail = pos.extreme - side * pos.setup.trail_atr * snap.atr
            pos.stop = max(pos.stop, trail) if side is Side.LONG else min(pos.stop, trail)
        if not tr.tp1_hit and tr.bars_held >= pos.setup.time_stop_bars:
            self.exit(pos, bar.close, bar.close_time_ms, pos.size, "temps", c.taker_fee, c.slippage)
            self.finalize(pos)
            return True
        latent = pos.size * side * (bar.close - tr.entry) / tr.risk
        tr.path.append((bar.close_time_ms, pos.realized_net + latent))
        return False

    @staticmethod
    def apply_funding(
        pos: OpenPosition, bar: Bar, prev_close_ms: int, times: list[int], rates: list[float]
    ) -> None:
        """Funding dont l'horodatage tombe dans (clôture précédente, clôture de cette bougie].
        Taux positif : les longs paient les shorts."""
        tr = pos.t
        i = bisect.bisect_right(times, max(prev_close_ms, tr.entry_ms))
        j = bisect.bisect_right(times, bar.close_time_ms)
        for k in range(i, j):
            r = -tr.side * rates[k] * pos.size * bar.open / tr.risk
            pos.realized_net += r
            tr.funding_r += r
