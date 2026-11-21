"""Phase 2 — backtest de la stratégie « pullback dans la tendance » (4h + filtre journalier).

    uv run python scripts/download_archives.py     # une fois
    uv run python scripts/backtest_pullback.py     # → reports/phase2_pullback.md + .png

Les critères d'activation ci-dessous ont été FIXÉS AVANT la première exécution.
"""

from __future__ import annotations

import itertools
import math
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from sentinel.backtest.costs import CostModel
from sentinel.backtest.data import load_bars, load_funding, ms
from sentinel.backtest.engine import Backtester, Trade
from sentinel.backtest.metrics import (
    EquityStats,
    TradeStats,
    buy_and_hold,
    equity_stats,
    portfolio_equity,
    trade_stats,
)
from sentinel.backtest.walkforward import walk_forward
from sentinel.core.models import Bar, Market, Timeframe
from sentinel.strategies.base import Side
from sentinel.strategies.pullback import PullbackParams, TrendPullback

ROOT = Path("data/archive")
OUT = Path("reports")
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
DEAD = ["LUNAUSDT", "FTTUSDT"]
OOS_START = ms("2023-01-01")
RISK = 0.005

# --- Critères d'activation, figés avant de voir les résultats -----------------------------
ACTIVATION = {
    "min_oos_trades": 30,
    "min_oos_expectancy_r": 0.05,
    "min_oos_profit_factor": 1.15,
    "wf_expectancy_positive": True,
    "max_oos_drawdown": -0.10,  # le coupe-circuit prévu est à −10 %
}

CRASHES = [
    ("Krach COVID", "2020-03-08", "2020-03-20"),
    ("Krach mai 2021", "2021-05-10", "2021-05-24"),
    ("Effondrement LUNA", "2022-05-05", "2022-05-15"),
    ("Faillite FTX", "2022-11-06", "2022-11-12"),
    ("Krach août 2024", "2024-08-01", "2024-08-07"),
    ("Liquidations oct. 2025", "2025-10-09", "2025-10-13"),
]

GRID = {
    "tp1_r": [1.5, 2.0, 3.0],
    "trail_atr": [2.0, 3.0, 4.0],
    "time_stop_bars": [20, 30, 60],
}


def d(ts: int) -> str:
    return datetime.fromtimestamp(ts / 1000, UTC).strftime("%Y-%m-%d")


@dataclass
class Dataset:
    market: Market
    symbol: str
    bars: dict[Timeframe, list[Bar]]
    funding: list[tuple[int, float]]


def load(market: Market, symbol: str) -> Dataset:
    return Dataset(
        market,
        symbol,
        {tf: load_bars(ROOT, market, symbol, tf) for tf in (Timeframe.H4, Timeframe.D1)},
        load_funding(ROOT, symbol) if market is Market.PERP else [],
    )


def run(ds: Dataset, p: PullbackParams, costs: CostModel | None = None) -> list[Trade]:
    bt = Backtester(lambda: TrendPullback(p), costs or CostModel.for_market(ds.market))
    return bt.run(ds.symbol, ds.market, ds.bars, ds.funding)


def fmt_ts(s: TradeStats) -> str:
    if s.n == 0:
        return "| 0 | – | – | – | – | – | – |"
    pf = "∞" if math.isinf(s.profit_factor) else f"{s.profit_factor:.2f}"
    return (
        f"| {s.n} | {s.win_rate:.0%} | {s.expectancy_r:+.3f} "
        f"[{s.exp_ci_low:+.2f} ; {s.exp_ci_high:+.2f}] | {s.expectancy_gross_r:+.3f} | {pf} "
        f"| {s.total_r:+.1f} | {s.avg_bars:.0f} |"
    )


TS_COLS = (
    "Trades | Win rate | Espérance nette R [IC 95 %] | Espérance brute R | "
    "Profit factor | Total R | Durée moy. (bougies 4h) |"
)


def ts_header(*first: str) -> str:
    cols = "".join(f"| {c} " for c in first)
    return f"{cols}| {TS_COLS}\n" + "|---" * (len(first) + 7) + "|"


def fmt_eq(name: str, e: EquityStats) -> str:
    mar = "∞" if math.isinf(e.mar) else f"{e.mar:.2f}"
    return (
        f"| {name} | {e.cagr:+.1%} | {e.vol:.1%} | {e.sharpe:.2f} | {e.sortino:.2f} | "
        f"{e.max_dd:.1%} | {mar} | {e.exposure:.0%} |"
    )


EQ_HEADER = (
    "| Série | CAGR | Volatilité | Sharpe | Sortino | Max drawdown | CAGR/MaxDD | "
    "Exposition |\n|---|---|---|---|---|---|---|---|"
)


def split(trades: Sequence[Trade], a: int, b: int) -> list[Trade]:
    return [t for t in trades if a <= t.entry_ms < b]


def basket_bh(datasets: list[Dataset], a: int, b: int) -> tuple[np.ndarray, np.ndarray]:
    curves = []
    for ds in datasets:
        daily = ds.bars[Timeframe.D1]
        g, c = buy_and_hold(
            np.array([x.close_time_ms for x in daily]), np.array([x.close for x in daily]), a, b
        )
        curves.append((g, c))
    g0 = curves[0][0]
    for g, _ in curves[1:]:
        g0 = g0[np.isin(g0, g)]
    eq = np.mean([c[np.isin(g, g0)] / c[np.isin(g, g0)][0] for g, c in curves], axis=0)
    return g0, eq


def main() -> None:
    t0 = time.perf_counter()
    OUT.mkdir(exist_ok=True)
    base = PullbackParams()
    lines: list[str] = []
    w = lines.append
    w("# Phase 2 — Backtest « Pullback dans la tendance » (4h, filtre journalier)\n")
    w(
        f"_Généré le {datetime.now(UTC):%Y-%m-%d %H:%M} UTC par "
        "`uv run python scripts/backtest_pullback.py`. Aucun chiffre n'est saisi à la main._\n"
    )
    w("## Hypothèses\n")
    w("- Données : archives officielles Binance (data.binance.vision), bougies 4h et 1j.")
    w(
        "- Signal à la clôture 4h, **entrée à l'ouverture suivante**. Stop/objectif touchés dans "
        "la même bougie : **stop supposé en premier**. Gap au-delà du stop : sortie à l'ouverture."
    )
    w(
        "- Coûts spot : taker 0,10 %, maker 0,10 %, slippage 0,05 % (×2 sur les stops). "
        "Perp : taker 0,05 %, maker 0,02 %, même slippage, **funding réel** historique."
    )
    w(
        f"- Portefeuille : {RISK:.1%} du capital risqué par trade, risque ouvert total ≤ 1,5 % "
        "(BTC/ETH/SOL sont corrélés), notionnel ≤ 1× le capital (aucun levier). Équité "
        "valorisée chaque jour au prix de marché."
    )
    w(
        "- Les statistiques de trades couvrent tout l'historique de chaque actif (BTC/ETH dès "
        "2019) ; le portefeuille commun démarre quand les 3 actifs ont des données (SOL : "
        "août 2020 en spot, sept. 2020 en perp)."
    )
    w(
        f"- In-sample : début des données → 2022-12-31. **Hors échantillon : {d(OOS_START)} → fin.** "
        "Les règles ont été écrites avant tout test ; elles n'ont pas été ajustées."
    )
    w(f"- Paramètres par défaut : `{base}`\n")
    w(
        "**Critères d'activation (fixés avant exécution)** : "
        + ", ".join(f"`{k}={v}`" for k, v in ACTIVATION.items())
        + "\n"
    )

    verdicts: dict[str, bool] = {}
    curves: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    for market in (Market.SPOT, Market.PERP):
        params = base.with_(allow_short=market is Market.PERP)
        datasets = [load(market, s) for s in SYMBOLS]
        label = "SPOT (long uniquement)" if market is Market.SPOT else "PERP (long + short)"
        w(f"\n## {label}\n")
        all_trades: dict[str, list[Trade]] = {ds.symbol: run(ds, params) for ds in datasets}
        pooled = [t for ts in all_trades.values() for t in ts]
        data_start = max(ds.bars[Timeframe.H4][0].open_time_ms for ds in datasets)
        data_end = min(ds.bars[Timeframe.H4][-1].close_time_ms for ds in datasets)

        w("### Statistiques de trades\n")
        w(ts_header("Actif", "Période"))
        for sym, ts in [*all_trades.items(), ("**Total**", pooled)]:
            for per, a, b in (("IS", 0, OOS_START), ("OOS", OOS_START, 2**62)):
                w(f"| {sym} | {per} " + fmt_ts(trade_stats(split(ts, a, b))))
        if market is Market.PERP:
            for side in (Side.LONG, Side.SHORT):
                st = trade_stats([t for t in split(pooled, OOS_START, 2**62) if t.side is side])
                w(f"| Total OOS | {side.name} " + fmt_ts(st))
            fr = sum(t.funding_r for t in pooled)
            w(f"\nFunding cumulé payé/reçu sur tous les trades : **{fr:+.2f} R**.")

        w("\n### Portefeuille vs buy-and-hold\n")
        w(EQ_HEADER)
        oos_dd = 0.0
        for per, a, b in (
            ("IS", data_start, OOS_START),
            ("OOS", OOS_START, data_end),
            ("Total", data_start, data_end),
        ):
            g, eq, _taken, expo = portfolio_equity(split(pooled, a, b), a, b, risk_pct=RISK)
            es = equity_stats(g, eq, expo)
            if per == "OOS":
                oos_dd = es.max_dd
            if per == "Total":
                curves[label] = (g, eq)
            w(fmt_eq(f"Stratégie {per}", es))
            btc = datasets[0].bars[Timeframe.D1]
            gb, eb = buy_and_hold(
                np.array([x.close_time_ms for x in btc]), np.array([x.close for x in btc]), a, b
            )
            w(fmt_eq(f"B&H BTC {per}", equity_stats(gb, eb)))
            gk, ek = basket_bh(datasets, a, b)
            w(fmt_eq(f"B&H panier égal {per}", equity_stats(gk, ek)))
            if per == "Total":
                curves["B&H BTC"] = (gb, eb)
                curves["B&H panier"] = (gk, ek)
        w(
            "\n_Comparer le CAGR brut est trompeur : la stratégie ne risque que 0,5 % par trade "
            "et n'est investie qu'une partie du temps. La comparaison pertinente est le couple "
            "Sharpe / max drawdown (rendement par unité de risque)._"
        )

        # --- Walk-forward + sensibilité ----------------------------------------------------
        combos = [
            base.with_(allow_short=market is Market.PERP, tp1_r=a, trail_atr=b, time_stop_bars=c)
            for a, b, c in itertools.product(*GRID.values())
        ]
        by_combo = [[t for ds in datasets for t in run(ds, p)] for p in combos]
        wf_oos, windows = walk_forward(by_combo, data_start, data_end)
        default_idx = combos.index(params)
        w("\n### Walk-forward (entraînement 24 mois → test 6 mois, glissant)\n")
        w(
            f"Grille : {GRID} → {len(combos)} combinaisons. Critère de choix : espérance R "
            "maximale sur la fenêtre d'entraînement (≥ 15 trades).\n"
        )
        w(
            "| Test | Combinaison choisie | Esp. entraînement | Trades test | Esp. test |\n|---|---|---|---|---|"
        )
        for win in windows:
            c = combos[win.chosen]
            w(
                f"| {d(win.test_start)} → {d(win.test_end)} | tp1={c.tp1_r}, trail={c.trail_atr}, "
                f"temps={c.time_stop_bars} | {win.train_exp:+.3f} | {win.test_n} | {win.test_exp:+.3f} |"
            )
        wf_s = trade_stats(wf_oos)
        test_from = windows[0].test_start if windows else data_end
        dflt_s = trade_stats(split(by_combo[default_idx], test_from, 2**62))
        w("\n" + ts_header("Version"))
        w("| Walk-forward (paramètres choisis sans voir l'avenir) " + fmt_ts(wf_s))
        w("| Paramètres par défaut, mêmes périodes " + fmt_ts(dflt_s))

        oos_exps = np.array(
            [trade_stats(split(t, OOS_START, 2**62)).expectancy_r for t in by_combo]
        )
        w(
            f"\n**Sensibilité (OOS, {len(combos)} combinaisons)** : espérance min {oos_exps.min():+.3f} R, "
            f"médiane {np.median(oos_exps):+.3f} R, max {oos_exps.max():+.3f} R ; "
            f"{(oos_exps > 0).mean():.0%} des combinaisons positives. "
            f"Combinaison par défaut : {oos_exps[default_idx]:+.3f} R."
        )
        w(
            "_Lecture : si seule une petite « île » de paramètres est positive, c'est du "
            "surapprentissage ; un avantage réel résiste à des variations raisonnables._"
        )

        # --- Krachs -----------------------------------------------------------------------
        w("\n### Comportement pendant les krachs\n")
        w(
            "| Épisode | Trades ouverts | R net de ces trades | Variation équité stratégie | BTC sur la période |\n|---|---|---|---|---|"
        )
        g_all, eq_all = curves[label]
        btc_d = datasets[0].bars[Timeframe.D1]
        bt_t = np.array([x.close_time_ms for x in btc_d])
        bt_c = np.array([x.close for x in btc_d])
        for name, a_s, b_s in CRASHES:
            a, b = ms(a_s), ms(b_s)
            if a < bt_t[0]:
                continue
            hit = [t for t in pooled if t.entry_ms < b and t.exit_ms > a]
            if a >= data_start:
                ia, ib = np.searchsorted(g_all, a), min(np.searchsorted(g_all, b), len(g_all) - 1)
                chg = f"{eq_all[ib] / eq_all[max(ia - 1, 0)] - 1:+.2%}"
            else:
                chg = "n/d (avant le début du portefeuille commun)"
            ja, jb = np.searchsorted(bt_t, a) - 1, np.searchsorted(bt_t, b) - 1
            w(
                f"| {name} ({a_s}) | {len(hit)} | {sum(t.r_net for t in hit):+.2f} | {chg} | "
                f"{bt_c[jb] / bt_c[ja] - 1:+.1%} |"
            )

        oos = trade_stats(split(pooled, OOS_START, 2**62))
        checks = {
            f"≥ {ACTIVATION['min_oos_trades']} trades OOS": oos.n >= ACTIVATION["min_oos_trades"],
            f"espérance OOS ≥ {ACTIVATION['min_oos_expectancy_r']} R": oos.expectancy_r
            >= ACTIVATION["min_oos_expectancy_r"],
            f"profit factor OOS ≥ {ACTIVATION['min_oos_profit_factor']}": oos.profit_factor
            >= ACTIVATION["min_oos_profit_factor"],
            "espérance walk-forward > 0": wf_s.expectancy_r > 0,
            f"max drawdown OOS > {ACTIVATION['max_oos_drawdown']:.0%}": oos_dd
            > ACTIVATION["max_oos_drawdown"],
        }
        w("\n### Verdict " + label + "\n")
        for k, v in checks.items():
            w(f"- {'✅' if v else '❌'} {k}")
        verdicts[label] = all(checks.values())
        w(
            f"\n**→ {'ACTIVABLE' if verdicts[label] else 'NON ACTIVÉE'}** "
            f"(IC 95 % de l'espérance OOS : [{oos.exp_ci_low:+.3f} ; {oos.exp_ci_high:+.3f}] R)"
        )

    # --- Biais de survie -------------------------------------------------------------------
    w("\n## Biais de survie : actifs morts (spot, long uniquement)\n")
    w(ts_header("Actif", "Période testée"))
    for sym in DEAD:
        ds = load(Market.SPOT, sym)
        tr = run(ds, base)
        h4 = ds.bars[Timeframe.H4]
        w(
            f"| {sym} | {d(h4[0].open_time_ms)} → {d(h4[-1].close_time_ms)} "
            + fmt_ts(trade_stats(tr))
        )
        last = [t for t in tr if t.exit_ms > h4[-1].close_time_ms - 30 * 86_400_000]
        for t in last:
            w(
                f"|  ↳ dernier trade | entrée {d(t.entry_ms)}, sortie {d(t.exit_ms)} "
                f"({t.exit_reason}) | {t.r_net:+.2f} R | | | | | |"
            )

    # --- Graphique -----------------------------------------------------------------------------
    fig, ax = plt.subplots(figsize=(11, 5.5), dpi=120)
    for name, (g, eq) in curves.items():
        x = [datetime.fromtimestamp(t / 1000, UTC) for t in g]
        ax.plot(x, eq, label=name, lw=1.6 if "Stratégie" in name or "(" in name else 1.0)
    ax.set_yscale("log")
    ax.axvline(datetime.fromtimestamp(OOS_START / 1000, UTC), color="grey", ls="--", lw=1)
    ax.text(
        datetime.fromtimestamp(OOS_START / 1000, UTC),
        ax.get_ylim()[1] * 0.8,
        "  hors échantillon →",
        color="grey",
    )
    ax.set_title("Équité (échelle log) — pullback 4h, 0,5 % de risque/trade vs buy-and-hold")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT / "phase2_pullback_equity.png")
    w("\n![Équité](phase2_pullback_equity.png)\n")
    w(f"\n_Temps de calcul : {time.perf_counter() - t0:.0f} s._")
    (OUT / "phase2_pullback.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
