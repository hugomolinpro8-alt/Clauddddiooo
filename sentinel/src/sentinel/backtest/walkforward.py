"""Walk-forward : la seule manière honnête de « choisir des paramètres ».

Principe : on découpe le temps en fenêtres. Sur chaque fenêtre d'entraînement (ex. 24 mois),
on choisit la meilleure combinaison de paramètres ; on l'applique ensuite, SANS la changer,
aux 6 mois suivants qu'elle n'a jamais vus. On avance de 6 mois et on recommence. La
performance retenue est celle de ces morceaux « jamais vus » mis bout à bout.

Si la version walk-forward fait nettement moins bien que la meilleure combinaison vue a
posteriori, c'est la mesure exacte du surapprentissage.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from sentinel.backtest.engine import Trade

MONTH_MS = 30 * 86_400_000


@dataclass(frozen=True, slots=True)
class WFWindow:
    train_start: int
    train_end: int
    test_start: int
    test_end: int
    chosen: int  # indice de la combinaison choisie
    train_exp: float
    test_n: int
    test_exp: float


def walk_forward(
    trades_by_combo: Sequence[Sequence[Trade]],
    start_ms: int,
    end_ms: int,
    train_months: int = 24,
    test_months: int = 6,
    min_train_trades: int = 15,
) -> tuple[list[Trade], list[WFWindow]]:
    oos: list[Trade] = []
    windows: list[WFWindow] = []
    t = start_ms
    while t + (train_months + test_months) * MONTH_MS <= end_ms + test_months * MONTH_MS:
        tr0, tr1 = t, t + train_months * MONTH_MS
        te0, te1 = tr1, min(tr1 + test_months * MONTH_MS, end_ms)
        if te0 >= end_ms:
            break
        best, best_exp = -1, -np.inf
        for i, trades in enumerate(trades_by_combo):
            r = [x.r_net for x in trades if tr0 <= x.entry_ms < tr1 and x.exit_ms < tr1]
            if len(r) >= min_train_trades and np.mean(r) > best_exp:
                best, best_exp = i, float(np.mean(r))
        if best >= 0:
            test = [x for x in trades_by_combo[best] if te0 <= x.entry_ms < te1]
            oos.extend(test)
            windows.append(
                WFWindow(
                    tr0,
                    tr1,
                    te0,
                    te1,
                    best,
                    best_exp,
                    len(test),
                    float(np.mean([x.r_net for x in test])) if test else 0.0,
                )
            )
        t += test_months * MONTH_MS
    return oos, windows
