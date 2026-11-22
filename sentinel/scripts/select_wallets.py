"""Sélectionne les portefeuilles smart money à suivre (≈ 5-15 min : quota API).

uv run python scripts/select_wallets.py [--candidates 40]
→ data/smart_money/wallets.json + reports/smart_money_selection.md
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import httpx

from sentinel.core.logging import configure_logging
from sentinel.smart_money.hl_client import HyperliquidClient
from sentinel.smart_money.selection import CopyCosts, Criteria
from sentinel.smart_money.service import run_selection, save_selection, short


async def main(n: int) -> None:
    configure_logging("WARNING")
    crit, costs = Criteria(), CopyCosts()
    async with httpx.AsyncClient(http2=True) as c:
        hl = HyperliquidClient(c)
        verdicts = await run_selection(hl, crit, costs, n_candidates=n)
        selected = save_selection(verdicts, Path("data/smart_money/wallets.json"), crit, costs)
    fails: Counter[str] = Counter()
    for v in verdicts:
        for k, ok in v.checks.items():
            if not ok:
                fails[k] += 1
    L = [
        "# Sélection smart money (Hyperliquid)",
        "",
        f"_Générée le {datetime.now(UTC):%Y-%m-%d %H:%M} UTC par "
        "`uv run python scripts/select_wallets.py` — {hl.requests} requêtes API._".replace(
            "{hl.requests}", str(hl.requests)
        ),
        "",
        f"Candidats présélectionnés au classement : **{len(verdicts)}** ; retenus : "
        f"**{len(selected)}**.",
        "",
        f"Rejeu de copie : capital {costs.capital:g} $, délai {costs.delay_ms // 1000} s, "
        f"frais taker {costs.taker_fee:.3%}, slippage {costs.slippage:.2%}, ordre minimum "
        f"{costs.min_notional:g} $.",
        "",
        "## Motifs de rejet",
        "",
    ]
    L += [f"- {k} : {n_} portefeuille(s)" for k, n_ in fails.most_common()] or ["- aucun"]
    L += [
        "",
        "## Portefeuilles évalués en détail",
        "",
        "| Portefeuille | Valeur compte (classement) | Historique | DD PnL | Mois + | "
        "Levier moy. | Copie 90 j (PnL $) | DD copie | Trades copiés | Retenu |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for v in verdicts:
        m = v.metrics
        if "copy_pnl" not in m:
            continue
        L.append(
            f"| {short(v.address)} | {v.account_value:,.0f} | {m['history_days']:.0f} j | "
            f"{m['pnl_drawdown']:.0%} | {m['positive_months']:.0%} | "
            f"{m['avg_leverage']:.1f}× | {m['copy_pnl']:+.1f} | {m['copy_dd']:.1%} | "
            f"{m['copy_trades']:.0f} | {'✅' if v.selected else '❌'} |"
        )
    L += [
        "",
        "## Limites",
        "",
        "- Couvertures sur d'autres plateformes et portefeuilles fractionnés : invisibles.",
        "- La valeur affichée au classement inclut spot/vaults : la copie se cale sur le compte "
        "perp réel.",
        "- Funding non simulé dans le rejeu.",
        "- Seules les 10 000 dernières exécutions sont accessibles via l'API.",
        "- 90 jours est court : un portefeuille retenu peut se dégrader → réévaluation mensuelle.",
    ]
    Path("reports/smart_money_selection.md").write_text("\n".join(L), encoding="utf-8")
    print("\n".join(L))
    print("\nRetenus :", [short(a) for a in selected])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=int, default=40)
    asyncio.run(main(ap.parse_args().candidates))
