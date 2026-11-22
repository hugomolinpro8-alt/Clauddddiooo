# Phase 5 — Le score de confluence prédit-il les trades ?

_Généré par `uv run python scripts/validate_score.py`._

Trades appariés (Donchian spot, BTC/ETH/SOL) : **64**.

| Période | Trades | Spearman score↔R | Esp. tiers bas | Esp. tiers milieu | Esp. tiers haut | Taille d'un tiers |
|---|---|---|---|---|---|---|
| In-sample | 25 | +0.57 | +1.61 R | +0.10 R | +18.46 R | 8 |
| Hors échantillon | 39 | -0.04 | +0.00 R | +3.15 R | +0.92 R | 13 |

**Composantes du score à chaque signal** (moyenne) :

- Multi-UT : 55% des points en moyenne (64 signaux)
- Régime : 39% des points en moyenne (64 signaux)
- Technique : 80% des points en moyenne (64 signaux)

**Verdict : NON VALIDÉ** (in-sample ✅, hors échantillon ❌).

Conséquence : le score reste **affiché à titre indicatif**, n'ajoute ni ne retire aucune alerte, et le seuil `alerts.min_score` reste à 0. Il sera réévalué avec les trades du paper trading (le score de chaque alerte est journalisé).