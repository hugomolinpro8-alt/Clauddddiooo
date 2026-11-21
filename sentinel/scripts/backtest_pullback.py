"""Essai n°1 — pullback dans la tendance (4h, filtre journalier).

    uv run python scripts/backtest_pullback.py   # → reports/phase2_pullback.md + .png

Critères d'activation fixés avant la première exécution (2026-11-21). Résultat : rejetée.
"""

from __future__ import annotations

from sentinel.backtest.research import Research, ResearchSpec
from sentinel.strategies.pullback import PullbackParams, TrendPullback

SPEC = ResearchSpec(
    trial=1,
    title="Pullback dans la tendance (4h, filtre journalier)",
    command="uv run python scripts/backtest_pullback.py",
    stem="phase2_pullback",
    rules=[
        "Régime journalier : close_1j > EMA50_1j > EMA200_1j (miroir pour le short, perp seul).",
        "Tendance 4h : EMA20 > EMA50, EMA20 montante, close > EMA50.",
        "Déclencheur : bougie précédente clôturée sous l'EMA20, bougie courante clôturée "
        "au-dessus et haussière.",
        "Stop : plus bas des 5 dernières bougies − 0,25 ATR ; risque entre 0,5 et 3 ATR.",
        "Gestion : 50 % à +2R, stop au point mort, reste en suiveur 3 ATR ; sortie après 30 "
        "bougies si +2R non atteint.",
    ],
    make_strategy=TrendPullback,
    base_params=PullbackParams(),
    grid={"tp1_r": [1.5, 2.0, 3.0], "trail_atr": [2.0, 3.0, 4.0], "time_stop_bars": [20, 30, 60]},
    activation={
        "min_oos_trades": 30,
        "min_oos_expectancy_r": 0.05,
        "min_oos_profit_factor": 1.15,
        "wf_expectancy_positive": 1,
        "max_oos_drawdown": -0.10,
    },
    bar_label="bougies 4h",
)

if __name__ == "__main__":
    print(Research(SPEC).run())
