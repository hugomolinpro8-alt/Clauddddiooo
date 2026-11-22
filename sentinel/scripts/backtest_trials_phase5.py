"""Phase 5 — essais n°3, 4 et 5. Critères fixés le 2026-11-22 AVANT toute exécution.

    uv run python scripts/backtest_trials_phase5.py

Essai 3 : retour à la moyenne en range (nouvelle stratégie). Seuils plus durs qu'aux essais
          1-2 : c'est le 3e passage sur la même période hors échantillon.
Essais 4-5 : filtres ajoutés à Donchian (volume, régime). Un filtre n'est retenu que s'il
          AMÉLIORE la version validée, de façon cohérente : espérance OOS ET Sharpe OOS
          ET espérance in-sample supérieurs, en gardant ≥ 50 % des trades. Un filtre qui
          n'améliore que l'OOS est probablement du bruit (on choisit après coup).
"""

from __future__ import annotations

import json
from pathlib import Path

from sentinel.backtest.research import Research, ResearchSpec
from sentinel.strategies.donchian import DonchianParams, DonchianTrend
from sentinel.strategies.mean_reversion import MeanReversionParams, RangeReversion

STRICT = {
    "min_oos_trades": 30,
    "min_oos_expectancy_r": 0.15,
    "min_oos_profit_factor": 1.30,
    "wf_expectancy_positive": 1,
    "max_oos_drawdown": -0.10,
    "min_grid_positive_frac": 0.60,
    "min_oos_exp_ex_top3": 0.0,
    "min_oos_exp_cost_x2": 0.0,
}
DONCHIAN_GRID = {"entry_n": [20, 55, 100], "exit_n": [10, 20, 40], "stop_atr": [1.5, 2.0, 3.0]}

TRIAL3 = ResearchSpec(
    trial=3,
    title="Retour à la moyenne en range (4h, filtre ADX journalier)",
    command="uv run python scripts/backtest_trials_phase5.py",
    stem="trial3_range_reversion",
    rules=[
        "Régime : ADX journalier < 20 (range).",
        "Entrée long : clôture 4h < bande de Bollinger basse (20, 2) et RSI(14) < 30 "
        "(short miroir sur perp).",
        "Stop : clôture − 1,5 ATR ; objectif : moyenne de Bollinger, 100 % ; objectif ≥ 0,5 R.",
        "Sortie temporelle : 12 bougies 4h.",
    ],
    make_strategy=RangeReversion,
    base_params=MeanReversionParams(),
    grid={
        "rsi_max": [25.0, 30.0, 35.0],
        "stop_atr": [1.0, 1.5, 2.0],
        "time_stop_bars": [6, 12, 24],
    },
    activation=STRICT,
    bar_label="bougies 4h",
)


def donchian_variant(trial: int, title: str, stem: str, rule: str, **kw: float) -> ResearchSpec:
    return ResearchSpec(
        trial=trial,
        title=title,
        command="uv run python scripts/backtest_trials_phase5.py",
        stem=stem,
        rules=["Donchian 55/20 de l'essai n°2, inchangé.", rule],
        make_strategy=DonchianTrend,
        base_params=DonchianParams(**kw),
        grid=DONCHIAN_GRID,
        activation=STRICT,
        bar_label="jours",
        min_train_trades=8,
        export_stats=False,
    )


TRIAL4 = donchian_variant(
    4,
    "Donchian + filtre de volume",
    "trial4_donchian_volume",
    "Filtre : volume de la bougie de cassure ≥ 1,5 × moyenne 20 j.",
    min_relvol=1.5,
)
TRIAL5 = donchian_variant(
    5,
    "Donchian + filtre de régime (ADX ≥ 20)",
    "trial5_donchian_regime",
    "Filtre : ADX journalier ≥ 20 au moment de la cassure (pas en range).",
    min_adx=20.0,
)


def main() -> None:
    base = json.loads(Path("reports/stats/donchian_trend.json").read_text())
    results = {}
    r3 = Research(TRIAL3)
    results["trial3"] = {"verdicts": r3.run(), "summary": r3.summary}
    print("Essai 3 :", results["trial3"]["verdicts"])

    # référence : la Donchian validée (essai 2), recalculée avec le même protocole
    ref = Research(donchian_variant(2, "Donchian (référence)", "tmp_donchian_ref", "aucun filtre"))
    ref.run()
    Path("reports/tmp_donchian_ref.md").unlink(missing_ok=True)
    Path("reports/tmp_donchian_ref_equity.png").unlink(missing_ok=True)
    for key, spec in (("trial4", TRIAL4), ("trial5", TRIAL5)):
        r = Research(spec)
        v = r.run()
        comp = {}
        for label, s in r.summary.items():
            b = ref.summary[label]
            better = {
                "espérance OOS supérieure": s["exp"] > b["exp"],
                "Sharpe OOS supérieur": s["sharpe"] > b["sharpe"],
                "espérance in-sample supérieure": s["is_exp"] > b["is_exp"],
                "≥ 50 % des trades conservés": s["n"] + s["is_n"] >= 0.5 * (b["n"] + b["is_n"]),
            }
            comp[label] = {
                "better": better,
                "keep": all(better.values()) and v[label],
                "filter": s,
                "base": b,
            }
        results[key] = {"verdicts": v, "comparison": comp}
        md = Path(f"reports/{spec.stem}.md")
        lines = [
            "",
            "## Comparaison avec la Donchian validée (essai n°2)",
            "",
            "| Marché | Espérance OOS (filtre / base) | Sharpe OOS | Espérance IS | "
            "Trades IS+OOS | Retenu ? |",
            "|---|---|---|---|---|---|",
        ]
        for label, c in comp.items():
            s, b = c["filter"], c["base"]
            lines.append(
                f"| {label} | {s['exp']:+.3f} / {b['exp']:+.3f} R | {s['sharpe']:.2f} / "
                f"{b['sharpe']:.2f} | {s['is_exp']:+.3f} / {b['is_exp']:+.3f} R | "
                f"{s['n'] + s['is_n']} / {b['n'] + b['is_n']} | {'✅' if c['keep'] else '❌'} |"
            )
            for k, ok in c["better"].items():
                lines.append(f"|  | {'✅' if ok else '❌'} {k} | | | | |")
        md.write_text(md.read_text(encoding="utf-8") + "\n".join(lines), encoding="utf-8")
        print(f"{key} :", {lbl: c["keep"] for lbl, c in comp.items()})
    Path("reports/stats/phase5_trials.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False, default=str), encoding="utf-8"
    )
    _ = base


if __name__ == "__main__":
    main()
