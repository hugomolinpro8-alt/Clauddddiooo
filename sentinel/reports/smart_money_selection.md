# Sélection smart money (Hyperliquid)

_Générée le 2026-11-22 13:48 UTC par `uv run python scripts/select_wallets.py` — 201 requêtes API._

Candidats présélectionnés au classement : **200** ; retenus : **0**.

Rejeu de copie : capital 3000 $, délai 60 s, frais taker 0.045%, slippage 0.05%, ordre minimum 10 $.

## Motifs de rejet

- drawdown PnL ≤ 30% : 163 portefeuille(s)
- mois positifs ≥ 60% : 133 portefeuille(s)
- meilleur mois ≤ 50% des gains : 76 portefeuille(s)
- historique ≥ 180 j : 16 portefeuille(s)
- historique disponible : 7 portefeuille(s)
- ≥ 10 trades copiables : 1 portefeuille(s)
- copie rentable après frais/délai : 1 portefeuille(s)

## Portefeuilles évalués en détail

| Portefeuille | Valeur compte (classement) | Historique | DD PnL | Mois + | Levier moy. | Copie 90 j (PnL $) | DD copie | Trades copiés | Retenu |
|---|---|---|---|---|---|---|---|---|---|
| 0x0a0b…f615 | 217,570 | 893 j | 0% | 77% | 0.0× | +0.0 | 0.0% | 0 | ❌ |

## Limites

- Couvertures sur d'autres plateformes et portefeuilles fractionnés : invisibles.
- La valeur affichée au classement inclut spot/vaults : la copie se cale sur le compte perp réel.
- Funding non simulé dans le rejeu.
- Seules les 10 000 dernières exécutions sont accessibles via l'API.
- 90 jours est court : un portefeuille retenu peut se dégrader → réévaluation mensuelle.
## Diagnostic : rejeu de copie sur 5 portefeuilles actifs (rejetés par les filtres d'historique)

Lancé pour vérifier la mécanique de rejeu sur données réelles, puisqu'aucun portefeuille n'a
passé les filtres préalables. Capital 3 000 $, délai 60 s, frais, slippage, ordre minimum
10 $, exposition plafonnée à 3× le capital.

```
0x45d2…4029 fills  5150 | copiés  106, ignorés (< 10 $) 5044, plafonnés  869, sans compte   0 | PnL copie   -127.8 $ | frais    5.5 $ | DD  9.7% | levier moy  3.0× max   5.2× | martingale 22% | échecs historique : ['drawdown PnL ≤ 30%', 'mois positifs ≥ 60%']
0xd475…1a91 fills  1205 | copiés  144, ignorés (< 10 $) 1061, plafonnés  469, sans compte   0 | PnL copie   -892.5 $ | frais    8.0 $ | DD 29.7% | levier moy  2.7× max   6.2× | martingale 0% | échecs historique : ['drawdown PnL ≤ 30%']
0x13c5…28be fills   810 | copiés    0, ignorés (< 10 $)    0, plafonnés    0, sans compte 810 | PnL copie     +0.0 $ | frais    0.0 $ | DD  0.0% | levier moy  0.0× max   0.0× | martingale 100% | échecs historique : ['mois positifs ≥ 60%', 'meilleur mois ≤ 50% des gains']
0x8e09…70c9 fills  5076 | copiés  868, ignorés (< 10 $) 4208, plafonnés 3748, sans compte   0 | PnL copie   +255.6 $ | frais   34.9 $ | DD 29.6% | levier moy  8.6× max 238.4× | martingale 36% | échecs historique : ['drawdown PnL ≤ 30%']
0x939f…04d2 fills  4057 | copiés  469, ignorés (< 10 $) 3588, plafonnés 2693, sans compte   0 | PnL copie  +2241.5 $ | frais   19.4 $ | DD 66.0% | levier moy  6.6× max  10.1× | martingale 46% | échecs historique : ['drawdown PnL ≤ 30%', 'mois positifs ≥ 60%']
requêtes API : 945
```

Lecture :
- **Petit capital** : la grande majorité des ordres copiés tomberaient sous l'ordre minimum de
  10 $ (ex. 5 044 sur 5 150). Copier un compte de plusieurs millions avec 3 000 € revient à ne
  copier qu'une fraction de ses décisions — un biais à part entière.
- Le seul rejeu fortement positif (+2 241 $) s'accompagne d'un drawdown de 66 % et de 46 %
  d'épisodes de type martingale : exactement ce que les filtres doivent écarter.
- Les drawdowns des gros gagnants du classement sont massifs (médiane 86-100 %, mesure
  pondérée dans le temps et Modified Dietz concordantes) : peu de comptes « réguliers » existent
  parmi eux.
