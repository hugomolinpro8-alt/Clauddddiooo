"""Paper trading : chaque alerte envoyée devient un trade simulé, suivi automatiquement.

Garanties :
  - même mécanique que le backtest (`PositionEngine`) : entrée à l'ouverture suivante,
    stop d'abord, gaps, frais, slippage, stop suiveur. Un écart paper/backtest ne peut
    donc venir que du marché, pas du code ;
  - taille selon le risque, sous le plafond de risque ouvert total (positions corrélées) ;
  - persistance SQLite : au redémarrage, les trades ouverts sont rechargés, puis rejoués
    sur les bougies manquées pendant l'arrêt (via la chauffe) ;
  - coupe-circuit : si l'équité papier recule de plus de `max_drawdown_pct` depuis son
    plus haut, les alertes passent en mode « observation seulement ».

Tout est synchrone et en mémoire ; les écritures disque et les messages Telegram sont mis
dans une « boîte d'envoi » (outbox) traitée par des tâches asynchrones.
"""

from __future__ import annotations

import json
import math
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
from typing import Any

from sentinel.backtest.costs import CostModel
from sentinel.backtest.position import OpenPosition, PositionEngine, Trade
from sentinel.core.config import RiskConfig
from sentinel.core.logging import get_logger
from sentinel.core.models import Bar, Market, Timeframe
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.journal.db import PaperRow
from sentinel.paper.divergence import Divergence, divergence_test
from sentinel.risk.sizing import allowed_risk_pct, position_size
from sentinel.strategies.base import Setup, Side

log = get_logger(__name__)


@dataclass(slots=True)
class PaperTrade:
    id: int
    alert_id: int | None
    alert_msg_id: int | None
    setup: Setup
    market: Market
    symbol: str
    timeframe: Timeframe
    risk_amount: float  # € risqués
    created_ms: int
    status: str = "pending"  # pending → open → closed | cancelled
    pos: OpenPosition | None = None
    last_bar_ms: int = 0
    result: Trade | None = None

    @property
    def key(self) -> tuple[Market, str]:
        return (self.market, self.symbol)

    def latent_r(self) -> float:
        if self.pos is None or not self.pos.t.path:
            return 0.0
        return self.pos.t.path[-1][1]

    def pnl_eur(self) -> float:
        if self.status == "closed" and self.result is not None:
            return self.result.r_net * self.risk_amount
        if self.status == "open":
            return self.latent_r() * self.risk_amount
        return 0.0


@dataclass
class Outbox:
    """Effets de bord en attente : écritures journal et notifications Telegram."""

    writes: list[tuple[str, tuple[Any, ...]]] = field(default_factory=list)
    messages: list[tuple[str, int | None]] = field(default_factory=list)  # (texte, reply_to)

    def drain(self) -> tuple[list[tuple[str, tuple[Any, ...]]], list[tuple[str, int | None]]]:
        w, m = self.writes, self.messages
        self.writes, self.messages = [], []
        return w, m


# --- sérialisation (persistance des positions ouvertes) -----------------------------------
def _setup_to_dict(s: Setup) -> dict[str, Any]:
    d = asdict(s)
    d["side"] = int(s.side)
    return d


def _setup_from_dict(d: dict[str, Any]) -> Setup:
    return Setup(**{**d, "side": Side(d["side"])})


def _pos_to_dict(p: OpenPosition) -> dict[str, Any]:
    t = asdict(p.t)
    t["side"] = int(p.t.side)
    t["market"] = p.t.market.value
    t["path"] = t["path"][-3:]
    return {
        "t": t,
        "stop": p.stop,
        "size": p.size,
        "extreme": p.extreme,
        "realized_net": p.realized_net,
        "realized_gross": p.realized_gross,
    }


def _pos_from_dict(d: dict[str, Any], setup: Setup) -> OpenPosition:
    t = dict(d["t"])
    t["side"] = Side(t["side"])
    t["market"] = Market(t["market"])
    t["path"] = [tuple(x) for x in t["path"]]
    return OpenPosition(
        Trade(**t),
        setup,
        d["stop"],
        d["size"],
        d["extreme"],
        d["realized_net"],
        d["realized_gross"],
    )


class PaperTracker:
    def __init__(
        self,
        risk: RiskConfig,
        costs_for: Callable[[Market], CostModel] = CostModel.for_market,
        ref_oos_r: Mapping[str, list[float]] | None = None,
        divergence_min_trades: int = 8,
        divergence_alpha: float = 0.05,
    ) -> None:
        self.risk = risk
        self._pe = {m: PositionEngine(costs_for(m)) for m in Market}
        self.trades: dict[int, PaperTrade] = {}
        self.outbox = Outbox()
        self._recent: dict[tuple[Market, str, Timeframe], deque[tuple[float, float]]] = {}
        self._next_id = 1
        self._next_alert_id = 1
        self.peak_equity = risk.capital_eur
        self.breaker_tripped = False
        self.ref_oos_r = dict(ref_oos_r or {})
        self.div_min = divergence_min_trades
        self.div_alpha = divergence_alpha
        self._div_flagged: set[str] = set()

    # --- état du portefeuille papier ----------------------------------------------------
    def open_risk_eur(self) -> float:
        return sum(t.risk_amount for t in self.trades.values() if t.status in ("pending", "open"))

    def open_risk_pct(self) -> float:
        return self.open_risk_eur() / self.risk.capital_eur * 100.0

    def closed(self, strategy: str | None = None) -> list[PaperTrade]:
        return [
            t
            for t in self.trades.values()
            if t.status == "closed" and (strategy is None or t.setup.strategy == strategy)
        ]

    def active(self) -> list[PaperTrade]:
        return [t for t in self.trades.values() if t.status in ("pending", "open")]

    def equity(self) -> float:
        return self.risk.capital_eur + sum(t.pnl_eur() for t in self.trades.values())

    def drawdown(self) -> float:
        return self.equity() / self.peak_equity - 1.0

    def next_alert_id(self) -> int:
        aid = self._next_alert_id
        self._next_alert_id += 1
        return aid

    # --- création depuis une alerte envoyée --------------------------------------------
    def allowed_risk_pct(self) -> float:
        return allowed_risk_pct(
            self.risk.risk_per_trade_pct, self.risk.max_open_risk_pct, self.open_risk_pct()
        )

    def add_from_alert(
        self, setup: Setup, bar: Bar, alert_id: int | None, alert_msg_id: int | None
    ) -> PaperTrade | None:
        pct = self.allowed_risk_pct()
        if pct <= 0:
            log.warning("paper_skipped_risk_cap", symbol=bar.symbol)
            self.outbox.messages.append(
                (
                    f"⏸️ Paper : {bar.symbol} non pris — plafond de risque ouvert atteint "
                    f"({self.risk.max_open_risk_pct:g} %).",
                    alert_msg_id,
                )
            )
            return None
        size = position_size(
            self.risk.capital_eur, pct, setup.signal_close, setup.stop, bar.key.market
        )
        t = PaperTrade(
            self._next_id,
            alert_id,
            alert_msg_id,
            setup,
            bar.key.market,
            bar.symbol,
            bar.timeframe,
            size.risk_amount,
            bar.close_time_ms,
            last_bar_ms=bar.open_time_ms,
        )
        self._next_id += 1
        self.trades[t.id] = t
        self._persist(t)
        return t

    # --- chaque bougie clôturée -----------------------------------------------------------
    def on_bar(self, snap: IndicatorSnapshot, bar: Bar) -> None:
        rk = (bar.key.market, bar.symbol, bar.timeframe)
        recent = self._recent.get(rk)
        if recent is None:
            recent = self._recent[rk] = deque(maxlen=500)
        todo = [
            t
            for t in self.trades.values()
            if t.status in ("pending", "open")
            and t.key == (bar.key.market, bar.symbol)
            and t.timeframe is bar.timeframe
            and bar.open_time_ms > t.last_bar_ms
        ]
        pe = self._pe[bar.key.market]
        for t in todo:
            if t.status == "pending":
                pos = pe.open(t.setup, bar, t.symbol, t.market)
                if pos is None:
                    t.status = "cancelled"
                    t.last_bar_ms = bar.open_time_ms
                    self._persist(t)
                    self.outbox.messages.append(
                        (
                            f"⏭️ Paper : {t.symbol} annulé — ouverture {bar.open:g} déjà au-delà du "
                            f"stop {t.setup.stop:g} (on ne poursuit pas le prix).",
                            t.alert_msg_id,
                        )
                    )
                    continue
                t.pos, t.status = pos, "open"
                self.outbox.messages.append(
                    (
                        f"📗 Paper : entrée simulée {t.symbol} {t.setup.side.name.lower()} à "
                        f"{pos.t.entry:g} (ouverture), stop {pos.stop:g}, risque "
                        f"{t.risk_amount:.2f} €.",
                        t.alert_msg_id,
                    )
                )
            assert t.pos is not None
            if pe.step(t.pos, bar):
                self._close(t)
            t.last_bar_ms = bar.open_time_ms
        recent.append((bar.high, bar.low))
        for t in todo:
            if (
                t.status == "open"
                and t.pos is not None
                and pe.after_close(t.pos, bar, snap, recent)
            ):
                self._close(t)
            if t.status in ("open", "closed"):
                self._persist(t)
        if todo:
            self._check_breaker(bar.close_time_ms)

    def _close(self, t: PaperTrade) -> None:
        assert t.pos is not None
        t.status = "closed"
        t.result = t.pos.t
        r, eur = t.result.r_net, t.result.r_net * t.risk_amount
        icon = "📕" if r <= 0 else "📘"
        self.outbox.messages.append(
            (
                f"{icon} Paper : sortie {t.symbol} ({t.result.exit_reason}) — {r:+.2f} R, "
                f"{eur:+.2f} €. Équité papier {self.equity():.2f} €.",
                t.alert_msg_id,
            )
        )
        self._check_divergence(t.setup.strategy, t.market)

    def _check_breaker(self, ts_ms: int) -> None:
        eq = self.equity()
        if eq > self.peak_equity:
            self.peak_equity = eq
            self.outbox.writes.append(("set_state", ("peak_equity", self.peak_equity)))
        dd = eq / self.peak_equity - 1.0
        if not self.breaker_tripped and dd <= -self.risk.max_drawdown_pct / 100.0:
            self.breaker_tripped = True
            self.outbox.writes.append(("set_state", ("breaker", True)))
            self.outbox.writes.append(("log_ops", (ts_ms, "breaker_tripped", f"{dd:.4f}")))
            self.outbox.messages.append(
                (
                    f"⛔ COUPE-CIRCUIT : drawdown papier {dd * 100:.1f} % (seuil "
                    f"−{self.risk.max_drawdown_pct:g} %). Les alertes passent en mode OBSERVATION "
                    "seulement. Réarmement manuel : /resume coupe-circuit",
                    None,
                )
            )

    def divergence(self, strategy: str, market: Market) -> Divergence | None:
        ref = self.ref_oos_r.get(f"{strategy}:{market.value}", [])
        paper = [
            t.result.r_net
            for t in self.closed(strategy)
            if t.market is market and t.result is not None
        ]
        return divergence_test(paper, ref, self.div_min, self.div_alpha)

    def _check_divergence(self, strategy: str, market: Market) -> None:
        d = self.divergence(strategy, market)
        key = f"{strategy}:{market.value}"
        if d is not None and d.diverging and key not in self._div_flagged:
            self._div_flagged.add(key)
            self.outbox.writes.append(("log_ops", (0, "divergence", key)))
            self.outbox.messages.append(
                (
                    f"⚠️ DIVERGENCE paper vs backtest — {strategy} ({market.value}) : "
                    f"moyenne paper {d.paper_mean:+.2f} R sur {d.n} trades, contre "
                    f"{d.ref_mean:+.2f} R en backtest hors échantillon (probabilité que ce "
                    f"soit de la malchance : {d.p_value:.1%}). "
                    "Je propose de SUSPENDRE la stratégie (/pause) et de la réexaminer.",
                    None,
                )
            )

    # --- persistance ----------------------------------------------------------------------
    def _persist(self, t: PaperTrade) -> None:
        state = {
            "setup": _setup_to_dict(t.setup),
            "timeframe": t.timeframe.value,
            "alert_msg_id": t.alert_msg_id,
            "pos": _pos_to_dict(t.pos) if t.pos is not None else None,
        }
        r = t.result
        self.outbox.writes.append(
            (
                "upsert_paper",
                (
                    {
                        "id": t.id,
                        "alert_id": t.alert_id,
                        "strategy": t.setup.strategy,
                        "market": t.market.value,
                        "symbol": t.symbol,
                        "side": t.setup.side.name,
                        "status": t.status,
                        "created_ms": t.created_ms,
                        "risk_amount": t.risk_amount,
                        "entry_ms": t.pos.t.entry_ms if t.pos else None,
                        "entry": t.pos.t.entry if t.pos else None,
                        "exit_ms": r.exit_ms if r else None,
                        "exit_reason": r.exit_reason if r else None,
                        "r_net": r.r_net if r else None,
                        "r_gross": r.r_gross if r else None,
                        "pnl_eur": t.pnl_eur() if t.status == "closed" else None,
                        "last_bar_ms": t.last_bar_ms,
                        "state": json.dumps(state, allow_nan=True),
                    },
                ),
            )
        )

    def load(
        self, rows: list[PaperRow], next_alert_id: int, peak_equity: float | None, breaker: bool
    ) -> None:
        """Recharge les trades depuis le journal (au démarrage, AVANT la chauffe)."""
        for row in rows:
            st = json.loads(row.state)
            setup = _setup_from_dict(st["setup"])
            t = PaperTrade(
                row.id,
                row.alert_id,
                st.get("alert_msg_id"),
                setup,
                Market(row.market),
                row.symbol,
                Timeframe(st["timeframe"]),
                row.risk_amount,
                row.created_ms,
                row.status,
                last_bar_ms=row.last_bar_ms,
            )
            if st.get("pos"):
                t.pos = _pos_from_dict(st["pos"], setup)
            if row.status == "closed" and t.pos is not None:
                t.result = t.pos.t
                t.result.r_net = row.r_net if row.r_net is not None else t.result.r_net
            self.trades[t.id] = t
        self._next_id = max([0, *self.trades]) + 1
        self._next_alert_id = next_alert_id
        if peak_equity is not None and math.isfinite(peak_equity):
            self.peak_equity = max(peak_equity, self.risk.capital_eur)
        self.breaker_tripped = breaker
