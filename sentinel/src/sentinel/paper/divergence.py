"""Le paper trading diverge-t-il du backtest ? Test statistique simple et honnête.

Question posée : « si la stratégie avait vraiment la distribution de trades du backtest
hors échantillon, quelle serait la probabilité d'observer une moyenne aussi mauvaise que
celle du paper trading, sur autant de trades ? » (bootstrap). Si cette probabilité est
sous 5 %, l'écart n'est probablement pas de la malchance : on propose de suspendre.

Limite assumée : avec 8-15 trades, le test n'a pas beaucoup de puissance ; un profil
« beaucoup de petites pertes, quelques gros gains » peut sembler mauvais longtemps.
C'est pourquoi on n'automatise pas la suspension : on la PROPOSE.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class Divergence:
    n: int
    paper_mean: float
    ref_mean: float
    p_value: float  # P(moyenne de n trades du backtest ≤ moyenne paper)
    diverging: bool


def divergence_test(
    paper_r: Sequence[float],
    ref_r: Sequence[float],
    min_trades: int = 8,
    alpha: float = 0.05,
    n_boot: int = 20_000,
    seed: int = 0,
) -> Divergence | None:
    if len(paper_r) < min_trades or len(ref_r) < 10:
        return None
    ref = np.asarray(ref_r, dtype=float)
    n = len(paper_r)
    pm = float(np.mean(paper_r))
    rng = np.random.default_rng(seed)
    means = rng.choice(ref, size=(n_boot, n), replace=True).mean(axis=1)
    p = float((means <= pm).mean())
    return Divergence(n, pm, float(ref.mean()), p, p < alpha)
