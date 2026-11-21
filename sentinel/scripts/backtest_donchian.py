"""Essai n°2 — suivi de tendance Donchian 55/20 en journalier.

    uv run python scripts/backtest_donchian.py   # → reports/trial2_donchian.md + .png

Critères fixés le 2026-11-21 AVANT la première exécution. Ils sont plus stricts que ceux de
l'essai n°1 : c'est le 2e essai confronté à la même période hors échantillon, et chaque
essai supplémentaire augmente la probabilité qu'un résultat positif soit dû au hasard.
"""

from __future__ import annotations

from sentinel.backtest.research import Research, ResearchSpec
from sentinel.strategies.donchian import DonchianParams, DonchianTrend

SPEC = ResearchSpec(
    trial=2,
    title="Suivi de tendance Donchian 55/20 (journalier)",
    command="uv run python scripts/backtest_donchian.py",
    stem="trial2_donchian",
    rules=[
        "Entrée long : clôture journalière > plus haut des 55 jours précédents "
        "(short miroir sur perp).",
        "Stop initial : clôture − 2 × ATR(14).",
        "Sortie : stop suiveur sur le plus bas des 20 derniers jours, jamais abaissé.",
        "Aucun objectif fixe ni sortie temporelle (on laisse courir les gains).",
    ],
    make_strategy=DonchianTrend,
    base_params=DonchianParams(),
    grid={"entry_n": [20, 55, 100], "exit_n": [10, 20, 40], "stop_atr": [1.5, 2.0, 3.0]},
    activation={
        "min_oos_trades": 30,
        "min_oos_expectancy_r": 0.10,
        "min_oos_profit_factor": 1.25,
        "wf_expectancy_positive": 1,
        "max_oos_drawdown": -0.10,
        "min_grid_positive_frac": 0.60,
        # Ajoutés APRÈS la 1re exécution (résultats jugés « trop beaux » pour être pris tels
        # quels) : ils ne peuvent que durcir le verdict, jamais l'assouplir.
        "min_oos_exp_ex_top3": 0.0,
        "min_oos_exp_cost_x2": 0.0,
    },
    bar_label="jours",
    min_train_trades=10,
    notes=[
        "Deux critères (concentration, coûts × 2) ont été ajoutés après la 1re exécution ; "
        "ils ne peuvent que durcir le verdict.",
        "Signal à la clôture journalière (00:00 UTC, soit 1h ou 2h à Paris), entrée à "
        "l'ouverture du jour suivant.",
    ],
)

if __name__ == "__main__":
    print(Research(SPEC).run())
