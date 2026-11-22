"""Protocole de recherche standard : MÊME procédure, MÊMES tableaux, MÊMES critères pour
toute stratégie. Un rapport ne peut pas être plus indulgent qu'un autre.

Pour chaque marché (spot long seul, perp long + short) :
  1. statistiques de trades par actif, in-sample / hors échantillon (OOS) ;
  2. portefeuille réaliste (risque fixe, plafonds) vs buy-and-hold BTC et panier ;
  3. walk-forward sur une grille de paramètres + sensibilité ;
  4. comportement pendant les krachs ;
  5. verdict automatique d'après des critères fixés AVANT l'exécution.
Puis test de survie sur des actifs morts, et graphique d'équité.
"""

from __future__ import annotations

import itertools
import json
import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
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
from sentinel.strategies.base import Side, Strategy

ROOT = Path("data/archive")
OUT = Path("reports")
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
DEAD = ["LUNAUSDT", "FTTUSDT"]
OOS_START = ms("2023-01-01")
FAR = 2**62

CRASHES = [
    ("Krach COVID", "2020-03-08", "2020-03-20"),
    ("Krach mai 2021", "2021-05-10", "2021-05-24"),
    ("Effondrement LUNA", "2022-05-05", "2022-05-15"),
    ("Faillite FTX", "2022-11-06", "2022-11-12"),
    ("Krach août 2024", "2024-08-01", "2024-08-07"),
    ("Liquidations oct. 2025", "2025-10-09", "2025-10-13"),
]


@dataclass
class ResearchSpec:
    trial: int
    title: str
    command: str
    stem: str
    rules: list[str]
    make_strategy: Callable[[Any], Strategy]
    base_params: Any  # dataclass figée avec `allow_short` et `.with_(**kw)`
    grid: dict[str, list[Any]]
    activation: dict[str, float]
    bar_label: str
    min_train_trades: int = 15
    risk_pct: float = 0.005
    notes: list[str] = field(default_factory=list)


@dataclass
class Dataset:
    market: Market
    symbol: str
    bars: dict[Timeframe, list[Bar]]
    funding: list[tuple[int, float]]


def d(ts: int) -> str:
    return datetime.fromtimestamp(ts / 1000, UTC).strftime("%Y-%m-%d")


def load(market: Market, symbol: str) -> Dataset:
    return Dataset(
        market,
        symbol,
        {tf: load_bars(ROOT, market, symbol, tf) for tf in (Timeframe.H4, Timeframe.D1)},
        load_funding(ROOT, symbol) if market is Market.PERP else [],
    )


def split(trades: Sequence[Trade], a: int, b: int) -> list[Trade]:
    return [t for t in trades if a <= t.entry_ms < b]


def _ts_cols(bar_label: str) -> str:
    return (
        "Trades | Win rate | Espérance nette R [IC 95 %] | Espérance brute R | "
        f"Profit factor | Total R | Durée moy. ({bar_label}) |"
    )


def _fmt_ts(s: TradeStats) -> str:
    if s.n == 0:
        return "| 0 | – | – | – | – | – | – |"
    pf = "∞" if math.isinf(s.profit_factor) else f"{s.profit_factor:.2f}"
    return (
        f"| {s.n} | {s.win_rate:.0%} | {s.expectancy_r:+.3f} "
        f"[{s.exp_ci_low:+.2f} ; {s.exp_ci_high:+.2f}] | {s.expectancy_gross_r:+.3f} | {pf} "
        f"| {s.total_r:+.1f} | {s.avg_bars:.0f} |"
    )


EQ_HEADER = (
    "| Série | CAGR | Volatilité | Sharpe | Sortino | Max drawdown | CAGR/MaxDD | "
    "Exposition |\n|---|---|---|---|---|---|---|---|"
)


def _fmt_eq(name: str, e: EquityStats) -> str:
    mar = "∞" if math.isinf(e.mar) else f"{e.mar:.2f}"
    return (
        f"| {name} | {e.cagr:+.1%} | {e.vol:.1%} | {e.sharpe:.2f} | {e.sortino:.2f} | "
        f"{e.max_dd:.1%} | {mar} | {e.exposure:.0%} |"
    )


def _bh(ds: Dataset, a: int, b: int) -> tuple[np.ndarray, np.ndarray]:
    daily = ds.bars[Timeframe.D1]
    return buy_and_hold(
        np.array([x.close_time_ms for x in daily]), np.array([x.close for x in daily]), a, b
    )


def _basket(datasets: list[Dataset], a: int, b: int) -> tuple[np.ndarray, np.ndarray]:
    curves = [_bh(ds, a, b) for ds in datasets]
    g0 = curves[0][0]
    for g, _ in curves[1:]:
        g0 = g0[np.isin(g0, g)]
    eq = np.mean([c[np.isin(g, g0)] / c[np.isin(g, g0)][0] for g, c in curves], axis=0)
    return g0, eq


class Research:
    def __init__(self, spec: ResearchSpec) -> None:
        self.spec = spec
        self.lines: list[str] = []
        self.curves: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self.verdicts: dict[str, bool] = {}
        self.summary: dict[str, dict[str, float]] = {}
        # statistiques par (marché, actif) exportées en JSON pour les alertes live
        self.per_asset: dict[str, dict[str, Any]] = {}
        # distribution des R hors échantillon par marché : référence du test de divergence
        self.per_market: dict[str, dict[str, Any]] = {}

    def w(self, s: str) -> None:
        self.lines.append(s)

    def ts_header(self, *first: str) -> str:
        cols = "".join(f"| {c} " for c in first)
        return f"{cols}| {_ts_cols(self.spec.bar_label)}\n" + "|---" * (len(first) + 7) + "|"

    def run_one(self, ds: Dataset, params: Any, cost_mult: float = 1.0) -> list[Trade]:
        costs = CostModel.for_market(ds.market).scaled(cost_mult)
        bt = Backtester(lambda: self.spec.make_strategy(params), costs)
        return bt.run(ds.symbol, ds.market, ds.bars, ds.funding)

    # ------------------------------------------------------------------------------------
    def run(self) -> dict[str, bool]:
        t0 = time.perf_counter()
        sp = self.spec
        OUT.mkdir(exist_ok=True)
        w = self.w
        w(f"# Essai n°{sp.trial} — {sp.title}\n")
        w(
            f"_Généré le {datetime.now(UTC):%Y-%m-%d %H:%M} UTC par `{sp.command}`. "
            "Aucun chiffre n'est saisi à la main._\n"
        )
        w("## Règles (figées avant toute exécution)\n")
        for r in sp.rules:
            w(f"- {r}")
        w(f"- Paramètres par défaut : `{sp.base_params}`\n")
        w("## Hypothèses d'exécution\n")
        w("- Données : archives officielles Binance (data.binance.vision).")
        w(
            "- Signal à la clôture, **entrée à l'ouverture suivante**. Stop/objectif touchés dans "
            "la même bougie : **stop supposé en premier**. Gap au-delà du stop : sortie à "
            "l'ouverture."
        )
        w(
            "- Coûts spot : taker 0,10 %, maker 0,10 %, slippage 0,05 % (×2 sur les stops). "
            "Perp : taker 0,05 %, maker 0,02 %, même slippage, **funding réel** historique."
        )
        w(
            f"- Portefeuille : {sp.risk_pct:.1%} du capital risqué par trade, risque ouvert total "
            "≤ 1,5 % (BTC/ETH/SOL sont corrélés), notionnel ≤ 1× le capital (aucun levier). "
            "Équité valorisée chaque jour au prix de marché."
        )
        w(
            "- Les statistiques de trades couvrent tout l'historique de chaque actif ; le "
            "portefeuille commun démarre quand les 3 actifs ont des données (SOL : août 2020 "
            "en spot, sept. 2020 en perp)."
        )
        w(f"- In-sample : début → 2022-12-31. **Hors échantillon (OOS) : {d(OOS_START)} → fin.**")
        for n in sp.notes:
            w(f"- {n}")
        w(
            "\n**Critères d'activation (fixés avant exécution)** : "
            + ", ".join(f"`{k}={v}`" for k, v in sp.activation.items())
            + "\n"
        )

        for market in (Market.SPOT, Market.PERP):
            self._market(market)
        self._survival()
        self._chart()
        w(f"\n_Temps de calcul : {time.perf_counter() - t0:.0f} s._")
        (OUT / f"{sp.stem}.md").write_text("\n".join(self.lines), encoding="utf-8")
        name = sp.make_strategy(sp.base_params).name
        stats_dir = OUT / "stats"
        stats_dir.mkdir(exist_ok=True)
        (stats_dir / f"{name}.json").write_text(
            json.dumps(
                {
                    "strategy": name,
                    "trial": sp.trial,
                    "generated": datetime.now(UTC).isoformat(),
                    "params": repr(sp.base_params),
                    "oos_start": d(OOS_START),
                    "verdicts": self.verdicts,
                    "per_asset": self.per_asset,
                    "per_market": self.per_market,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return self.verdicts

    # ------------------------------------------------------------------------------------
    def _market(self, market: Market) -> None:
        sp, w = self.spec, self.w
        params = sp.base_params.with_(allow_short=market is Market.PERP)
        datasets = [load(market, s) for s in SYMBOLS]
        main_tf = sp.make_strategy(params).timeframe
        label = "SPOT (long uniquement)" if market is Market.SPOT else "PERP (long + short)"
        w(f"\n## {label}\n")
        all_trades = {ds.symbol: self.run_one(ds, params) for ds in datasets}
        pooled = [t for ts in all_trades.values() for t in ts]
        data_start = max(ds.bars[main_tf][0].open_time_ms for ds in datasets)
        data_end = min(ds.bars[main_tf][-1].close_time_ms for ds in datasets)

        w("### Statistiques de trades\n")
        w(self.ts_header("Actif", "Période"))
        for sym, ts in [*all_trades.items(), ("**Total**", pooled)]:
            for per, a, b in (("IS", 0, OOS_START), ("OOS", OOS_START, FAR)):
                w(f"| {sym} | {per} " + _fmt_ts(trade_stats(split(ts, a, b))))
        oos_pooled = split(pooled, OOS_START, FAR)
        self.per_market[market.value] = {
            "oos_r": [round(t.r_net, 6) for t in oos_pooled],
            "oos_mean": float(np.mean([t.r_net for t in oos_pooled])) if oos_pooled else 0.0,
        }
        for sym, ts in all_trades.items():
            full, oo = trade_stats(ts), trade_stats(split(ts, OOS_START, FAR))
            self.per_asset[f"{market.value}:{sym}"] = {
                "n": full.n,
                "win_rate": full.win_rate,
                "expectancy_r": full.expectancy_r,
                "oos_n": oo.n,
                "oos_win_rate": oo.win_rate,
                "oos_expectancy_r": oo.expectancy_r,
                "avg_win_r": full.avg_win_r,
                "avg_loss_r": full.avg_loss_r,
            }
        if market is Market.PERP:
            for side in (Side.LONG, Side.SHORT):
                st = trade_stats([t for t in split(pooled, OOS_START, FAR) if t.side is side])
                w(f"| Total OOS | {side.name} " + _fmt_ts(st))
            funding = sum(t.funding_r for t in pooled)
            w(f"\nFunding cumulé sur tous les trades : **{funding:+.2f} R**.")

        w("\n### Portefeuille vs buy-and-hold\n")
        w(EQ_HEADER)
        oos_eq: EquityStats | None = None
        for per, a, b in (
            ("IS", data_start, OOS_START),
            ("OOS", OOS_START, data_end),
            ("Total", data_start, data_end),
        ):
            g, eq, _taken, expo = portfolio_equity(split(pooled, a, b), a, b, risk_pct=sp.risk_pct)
            es = equity_stats(g, eq, expo)
            if per == "OOS":
                oos_eq = es
            w(_fmt_eq(f"Stratégie {per}", es))
            gb, eb = _bh(datasets[0], a, b)
            w(_fmt_eq(f"B&H BTC {per}", equity_stats(gb, eb)))
            gk, ek = _basket(datasets, a, b)
            w(_fmt_eq(f"B&H panier égal {per}", equity_stats(gk, ek)))
            if per == "Total":
                self.curves[label] = (g, eq)
                self.curves["B&H BTC"] = (gb, eb)
                self.curves["B&H panier"] = (gk, ek)
        w(
            f"\n_Comparer le CAGR brut est trompeur : la stratégie ne risque que {sp.risk_pct:.1%} "
            "par trade et n'est investie qu'une partie du temps. La comparaison pertinente est le "
            "couple Sharpe / max drawdown (rendement par unité de risque)._"
        )

        combos = [
            sp.base_params.with_(
                allow_short=market is Market.PERP, **dict(zip(sp.grid, v, strict=True))
            )
            for v in itertools.product(*sp.grid.values())
        ]
        by_combo = [[t for ds in datasets for t in self.run_one(ds, p)] for p in combos]
        wf_oos, windows = walk_forward(
            by_combo, data_start, data_end, min_train_trades=sp.min_train_trades
        )
        try:
            default_idx = combos.index(params)
        except ValueError:
            default_idx = -1
        w("\n### Walk-forward (entraînement 24 mois → test 6 mois, glissant)\n")
        w(
            f"Grille : `{sp.grid}` → {len(combos)} combinaisons. Critère de choix : espérance R "
            f"maximale sur la fenêtre d'entraînement (≥ {sp.min_train_trades} trades).\n"
        )
        w(
            "| Test | Combinaison choisie | Esp. entraînement | Trades test | Esp. test |\n"
            "|---|---|---|---|---|"
        )
        for win in windows:
            c = combos[win.chosen]
            desc = ", ".join(f"{k}={getattr(c, k)}" for k in sp.grid)
            w(
                f"| {d(win.test_start)} → {d(win.test_end)} | {desc} | {win.train_exp:+.3f} | "
                f"{win.test_n} | {win.test_exp:+.3f} |"
            )
        if not windows:
            w("| _aucune fenêtre avec assez de trades d'entraînement_ | | | | |")
        wf_s = trade_stats(wf_oos)
        test_from = windows[0].test_start if windows else data_end
        w("\n" + self.ts_header("Version"))
        w("| Walk-forward (paramètres choisis sans voir l'avenir) " + _fmt_ts(wf_s))
        if default_idx >= 0:
            w(
                "| Paramètres par défaut, mêmes périodes "
                + _fmt_ts(trade_stats(split(by_combo[default_idx], test_from, FAR)))
            )

        oos_exps = np.array([trade_stats(split(t, OOS_START, FAR)).expectancy_r for t in by_combo])
        pos_frac = float((oos_exps > 0).mean())
        w(
            f"\n**Sensibilité (OOS, {len(combos)} combinaisons)** : espérance min "
            f"{oos_exps.min():+.3f} R, médiane {np.median(oos_exps):+.3f} R, max "
            f"{oos_exps.max():+.3f} R ; **{pos_frac:.0%} des combinaisons positives**."
        )
        w(
            "_Lecture : si seule une petite « île » de paramètres est positive, c'est du "
            "surapprentissage ; un avantage réel résiste à des variations raisonnables._"
        )

        self._crashes(label, pooled, datasets[0], data_start)

        # --- Robustesse : concentration, stress des coûts, régularité annuelle ----------------
        w("\n### Robustesse\n")
        oos_r = sorted(t.r_net for t in split(pooled, OOS_START, FAR))
        ex3 = float(np.mean(oos_r[:-3])) if len(oos_r) > 3 else 0.0
        ex5 = float(np.mean(oos_r[:-5])) if len(oos_r) > 5 else 0.0
        med = float(np.median(oos_r)) if oos_r else 0.0
        w(
            f"- **Concentration (OOS)** : espérance sans les 3 meilleurs trades {ex3:+.3f} R, sans "
            f"les 5 meilleurs {ex5:+.3f} R ; trade médian {med:+.3f} R."
        )
        stress: dict[float, float] = {}
        for k in (2.0, 3.0):
            st = trade_stats(
                split([t for ds in datasets for t in self.run_one(ds, params, k)], OOS_START, FAR)
            )
            stress[k] = st.expectancy_r
            w(
                f"- **Coûts × {k:.0f}** (frais et slippage) : espérance OOS "
                f"{st.expectancy_r:+.3f} R, "
                f"profit factor {st.profit_factor:.2f}."
            )
        years: dict[int, list[float]] = {}
        for t in pooled:
            years.setdefault(datetime.fromtimestamp(t.entry_ms / 1000, UTC).year, []).append(
                t.r_net
            )
        w(
            "- **Par année d'entrée** : "
            + " · ".join(f"{y} : {sum(v):+.1f} R ({len(v)})" for y, v in sorted(years.items()))
        )

        oos = trade_stats(split(pooled, OOS_START, FAR))
        act = sp.activation
        assert oos_eq is not None
        checks = {
            f"≥ {act['min_oos_trades']:.0f} trades OOS": oos.n >= act["min_oos_trades"],
            f"espérance OOS ≥ {act['min_oos_expectancy_r']} R": oos.expectancy_r
            >= act["min_oos_expectancy_r"],
            f"profit factor OOS ≥ {act['min_oos_profit_factor']}": oos.profit_factor
            >= act["min_oos_profit_factor"],
            "espérance walk-forward > 0": wf_s.n > 0 and wf_s.expectancy_r > 0,
            f"max drawdown OOS > {act['max_oos_drawdown']:.0%}": oos_eq.max_dd
            > act["max_oos_drawdown"],
        }
        if "min_oos_exp_ex_top3" in act:
            checks[
                f"espérance OOS sans les 3 meilleurs trades ≥ {act['min_oos_exp_ex_top3']} R"
            ] = ex3 >= act["min_oos_exp_ex_top3"]
        if "min_oos_exp_cost_x2" in act:
            checks[f"espérance OOS avec coûts × 2 ≥ {act['min_oos_exp_cost_x2']} R"] = (
                stress[2.0] >= act["min_oos_exp_cost_x2"]
            )
        if "min_grid_positive_frac" in act:
            checks[f"≥ {act['min_grid_positive_frac']:.0%} des combinaisons positives en OOS"] = (
                pos_frac >= act["min_grid_positive_frac"]
            )
        w(f"\n### Verdict {label}\n")
        for name, passed in checks.items():
            w(f"- {'✅' if passed else '❌'} {name}")
        ok = all(checks.values())
        self.verdicts[label] = ok
        self.summary[label] = {
            "n": oos.n,
            "exp": oos.expectancy_r,
            "lo": oos.exp_ci_low,
            "hi": oos.exp_ci_high,
            "pf": oos.profit_factor,
            "sharpe": oos_eq.sharpe,
            "dd": oos_eq.max_dd,
            "grid_pos": pos_frac,
            "wf": wf_s.expectancy_r,
            "gross": oos.expectancy_gross_r,
            "combos": len(combos),
            "ex3": ex3,
            "cost2": stress[2.0],
        }
        w(
            f"\n**→ {'ACTIVABLE' if ok else 'NON ACTIVÉE'}** (IC 95 % de l'espérance OOS : "
            f"[{oos.exp_ci_low:+.3f} ; {oos.exp_ci_high:+.3f}] R)"
        )

    def _crashes(self, label: str, pooled: list[Trade], btc: Dataset, data_start: int) -> None:
        w = self.w
        w("\n### Comportement pendant les krachs\n")
        w(
            "| Épisode | Trades ouverts | R net de ces trades | Variation équité stratégie | "
            "BTC sur la période |\n|---|---|---|---|---|"
        )
        g_all, eq_all = self.curves[label]
        daily = btc.bars[Timeframe.D1]
        bt_t = np.array([x.close_time_ms for x in daily])
        bt_c = np.array([x.close for x in daily])
        for name, a_s, b_s in CRASHES:
            a, b = ms(a_s), ms(b_s)
            if a < bt_t[0]:
                continue
            hit = [t for t in pooled if t.entry_ms < b and t.exit_ms > a]
            if a >= data_start:
                ia = int(np.searchsorted(g_all, a))
                ib = min(int(np.searchsorted(g_all, b)), len(g_all) - 1)
                chg = f"{eq_all[ib] / eq_all[max(ia - 1, 0)] - 1:+.2%}"
            else:
                chg = "n/d (avant le portefeuille commun)"
            ja, jb = np.searchsorted(bt_t, a) - 1, np.searchsorted(bt_t, b) - 1
            w(
                f"| {name} ({a_s}) | {len(hit)} | {sum(t.r_net for t in hit):+.2f} | {chg} | "
                f"{bt_c[jb] / bt_c[ja] - 1:+.1%} |"
            )

    def _survival(self) -> None:
        w = self.w
        w("\n## Biais de survie : actifs morts (spot, long uniquement)\n")
        w(self.ts_header("Actif", "Période testée"))
        for sym in DEAD:
            ds = load(Market.SPOT, sym)
            tr = self.run_one(ds, self.spec.base_params)
            h4 = ds.bars[Timeframe.H4]
            w(
                f"| {sym} | {d(h4[0].open_time_ms)} → {d(h4[-1].close_time_ms)} "
                + _fmt_ts(trade_stats(tr))
            )
            for t in [t for t in tr if t.exit_ms > h4[-1].close_time_ms - 30 * 86_400_000]:
                w(
                    f"|  ↳ dernier trade | entrée {d(t.entry_ms)}, sortie {d(t.exit_ms)} "
                    f"({t.exit_reason}) | {t.r_net:+.2f} R | | | | | |"
                )

    def _chart(self) -> None:
        fig, ax = plt.subplots(figsize=(11, 5.5), dpi=120)
        for name, (g, eq) in self.curves.items():
            x = mdates.date2num(  # type: ignore[no-untyped-call]
                [datetime.fromtimestamp(t / 1000, UTC) for t in g]
            )
            ax.plot(x, eq, label=name, lw=1.6 if "(" in name else 1.0)
        ax.set_yscale("log")
        ax.xaxis_date()
        oos = float(
            mdates.date2num(  # type: ignore[no-untyped-call]
                datetime.fromtimestamp(OOS_START / 1000, UTC)
            )
        )
        ax.axvline(oos, color="grey", ls="--", lw=1)
        ax.text(oos, ax.get_ylim()[1] * 0.8, "  hors échantillon →", color="grey")
        ax.set_title(
            f"Équité (échelle log) — {self.spec.title}, "
            f"{self.spec.risk_pct:.1%} de risque/trade vs buy-and-hold"
        )
        ax.legend()
        ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(OUT / f"{self.spec.stem}_equity.png")
        plt.close(fig)
        self.w(f"\n![Équité]({self.spec.stem}_equity.png)\n")
