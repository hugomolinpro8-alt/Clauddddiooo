"""Sélection (mensuelle) et suivi (continu) des portefeuilles smart money.

Le suivi n'est PAS sur le chemin critique : les positions des portefeuilles suivis sont
interrogées toutes les 60 s et gardées en mémoire ; au moment d'une alerte, le détecteur lit
cet état sans aucun appel réseau. Le smart money n'ajoute ou ne retire que des points au
score : il ne déclenche jamais une alerte seul et n'est jamais copié automatiquement.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sentinel.core.logging import get_logger
from sentinel.core.models import Market
from sentinel.scoring.confluence import SmartMoneyView
from sentinel.smart_money.hl_client import HyperliquidClient
from sentinel.smart_money.selection import (
    DAY_MS,
    CopyCosts,
    Criteria,
    PriceBook,
    WalletVerdict,
    copy_replay,
    evaluate,
    prefilter,
    track_record,
)
from sentinel.strategies.base import Side

log = get_logger(__name__)


def short(addr: str) -> str:
    return f"{addr[:6]}…{addr[-4:]}"


async def run_selection(
    hl: HyperliquidClient,
    criteria: Criteria | None = None,
    costs: CopyCosts | None = None,
    n_candidates: int = 40,
    replay_days: int = 90,
    max_coins: int = 8,
) -> list[WalletVerdict]:
    criteria, costs = criteria or Criteria(), costs or CopyCosts()
    now = int(time.time() * 1000)
    rows = await hl.leaderboard()
    cands = prefilter(rows, criteria, n_candidates)
    log.info("sm_prefilter", leaderboard=len(rows), candidates=len(cands))
    verdicts: list[WalletVerdict] = []
    start = now - replay_days * DAY_MS
    for cand in cands:
        addr = cand["address"]
        try:
            pf = await hl.portfolio(addr)
            rec = track_record(pf, now)
            # filtres bon marché d'abord : inutile de télécharger 90 j de fills sinon
            pre = evaluate(addr, cand["account_value"], rec, [], None, criteria)
            cheap = {
                k: ok
                for k, ok in pre.checks.items()
                if k.startswith(("historique", "drawdown PnL", "mois positifs", "meilleur"))
            }
            if not all(cheap.values()):
                pre.checks = cheap
                verdicts.append(pre)
                continue
            fills = await hl.fills_by_time(addr, start, now)
            copy = None
            if len(fills) < criteria.max_fills_90d:
                notional: dict[str, float] = {}
                for f in fills:
                    amount = float(f["sz"]) * float(f["px"])
                    notional[f["coin"]] = notional.get(f["coin"], 0.0) + amount
                coins = sorted(notional, key=lambda k: -notional[k])[:max_coins]
                candles = {c: await hl.candles(c, "1m", start, now) for c in coins}
                av_series = [
                    (int(t), float(v))
                    for t, v in (pf.get("perpAllTime") or pf.get("allTime") or {}).get(
                        "accountValueHistory", []
                    )
                ]
                copy = copy_replay(fills, av_series, PriceBook(candles), costs)
            v = evaluate(addr, cand["account_value"], rec, fills, copy, criteria)
            if copy is not None and copy.skipped_small:
                v.note = (
                    f"{copy.skipped_small} ordres sous {costs.min_notional:g} $ ignorés "
                    f"(capital {costs.capital:g})"
                )
            verdicts.append(v)
            log.info("sm_wallet_evaluated", wallet=short(addr), selected=v.selected)
        except Exception as e:
            log.warning("sm_wallet_failed", wallet=short(addr), error=repr(e))
            verdicts.append(
                WalletVerdict(
                    addr, cand["account_value"], {"données disponibles": False}, note=repr(e)[:120]
                )
            )
    return verdicts


def save_selection(
    verdicts: list[WalletVerdict],
    path: Path,
    criteria: Criteria,
    costs: CopyCosts,
    max_wallets: int = 10,
) -> list[str]:
    selected = sorted(
        (v for v in verdicts if v.selected),
        key=lambda v: -v.metrics.get("copy_pnl", 0) / max(v.metrics.get("copy_dd", 0), 0.01),
    )[:max_wallets]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "generated": datetime.now(UTC).isoformat(),
                "criteria": asdict(criteria),
                "costs": asdict(costs),
                "selected": [v.address for v in selected],
                "evaluated": [
                    {
                        "address": v.address,
                        "account_value": v.account_value,
                        "selected": v.selected,
                        "checks": v.checks,
                        "metrics": v.metrics,
                        "note": v.note,
                    }
                    for v in verdicts
                ],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return [v.address for v in selected]


def load_selection(path: Path) -> list[str]:
    if not path.exists():
        return []
    return list(json.loads(path.read_text(encoding="utf-8")).get("selected", []))


@dataclass(frozen=True, slots=True)
class WalletPosition:
    coin: str
    size: float  # > 0 long, < 0 short
    entry: float
    leverage: float
    liq_px: float | None
    mark: float | None

    @property
    def side(self) -> Side:
        return Side.LONG if self.size > 0 else Side.SHORT

    def liq_distance(self) -> float | None:
        if self.liq_px is None or not self.mark:
            return None
        return abs(self.mark - self.liq_px) / self.mark


def parse_positions(state: dict[str, Any]) -> list[WalletPosition]:
    out = []
    for ap in state.get("assetPositions", []):
        p = ap.get("position", {})
        szi = float(p.get("szi", 0) or 0)
        if szi == 0:
            continue
        value = float(p.get("positionValue", 0) or 0)
        mark = value / abs(szi) if szi else None
        lev = p.get("leverage", {})
        liq = p.get("liquidationPx")
        out.append(
            WalletPosition(
                p["coin"],
                szi,
                float(p.get("entryPx", 0) or 0),
                float(lev.get("value", 0) or 0),
                float(liq) if liq not in (None, "") else None,
                mark,
            )
        )
    return out


class SmartMoneyTracker:
    def __init__(self, hl: HyperliquidClient, wallets: list[str], poll_s: float = 60.0) -> None:
        self.hl = hl
        self.wallets = list(wallets)
        self.poll_s = poll_s
        self.positions: dict[str, list[WalletPosition]] = {}
        self.updated_ms: dict[str, int] = {}
        self.changes: list[str] = []  # journal des ouvertures/fermetures (pour le rapport hebdo)

    def set_wallets(self, wallets: list[str]) -> None:
        self.wallets = list(wallets)
        self.positions = {w: p for w, p in self.positions.items() if w in self.wallets}

    async def poll_once(self) -> None:
        for w in list(self.wallets):
            try:
                new = parse_positions(await self.hl.clearinghouse(w))
            except Exception as e:
                log.warning("sm_poll_failed", wallet=short(w), error=repr(e))
                continue
            old = {p.coin: p for p in self.positions.get(w, [])}
            cur = {p.coin: p for p in new}
            for coin in cur.keys() - old.keys():
                p = cur[coin]
                self.changes.append(
                    f"{short(w)} ouvre {p.side.name.lower()} {coin} (levier {p.leverage:g}×)"
                )
            for coin in old.keys() - cur.keys():
                self.changes.append(f"{short(w)} ferme {coin}")
            self.positions[w] = new
            self.updated_ms[w] = int(time.time() * 1000)
        self.changes = self.changes[-200:]

    async def run(self) -> None:
        while True:
            await self.poll_once()
            await asyncio.sleep(self.poll_s)

    def view(self, market: Market, symbol: str, side: Side) -> SmartMoneyView | None:
        """Lecture en mémoire, sans réseau : utilisable sur le chemin critique."""
        if not self.wallets:
            return None
        coin = symbol[:-4] if symbol.endswith("USDT") else symbol
        same = opp = 0
        details = []
        for w in self.wallets:
            for p in self.positions.get(w, []):
                if p.coin != coin:
                    continue
                liq = p.liq_distance()
                d = f"{short(w)} {p.side.name.lower()} {p.leverage:g}×" + (
                    f", liquidation à {liq:.0%}" if liq is not None else ""
                )
                if p.side is side:
                    same += 1
                else:
                    opp += 1
                details.append(d)
        return SmartMoneyView(same, opp, len(self.wallets), tuple(details[:4]))

    def describe(self) -> str:
        if not self.wallets:
            return (
                "🐋 Smart money : aucun portefeuille ne passe actuellement les critères "
                "(sélection stricte + rejeu de copie rentable sur 90 j)."
            )
        lines = [f"🐋 Smart money — {len(self.wallets)} portefeuille(s) suivi(s)"]
        for w in self.wallets:
            pos = self.positions.get(w)
            if pos is None:
                lines.append(f"• {short(w)} : positions pas encore lues")
            elif not pos:
                lines.append(f"• {short(w)} : aucune position")
            else:
                desc = ", ".join(
                    f"{p.coin} {p.side.name.lower()} {p.leverage:g}×"
                    + (f" (liq. à {p.liq_distance():.0%})" if p.liq_distance() is not None else "")
                    for p in pos[:5]
                )
                lines.append(f"• {short(w)} : {desc}")
        lines.append("Indice seulement : couvertures sur d'autres plateformes invisibles.")
        return "\n".join(lines)
