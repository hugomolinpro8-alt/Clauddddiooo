# Journal de recherche — registre des essais

Pourquoi ce fichier : chaque stratégie testée sur la même période hors échantillon (2023 → )
« use » un peu cette période. Après 20 essais, l'un d'eux passera les critères par pur hasard
(problème des tests multiples / data snooping). On note donc CHAQUE essai, y compris les
échecs, et les seuils d'activation se durciront avec le nombre d'essais.

| # | Date | Stratégie | Configurations évaluées | Résultat OOS (espérance nette, IC 95 %) | Décision |
|---|---|---|---|---|---|
| 1 | 2026-11-21 | trend_pullback 4h + filtre 1j — spot long | 1 (règles figées) + 27 en walk-forward | −0,003 R [−0,23 ; +0,24], PF 1,00, 185 trades | Rejetée |
| 1 | 2026-11-21 | trend_pullback 4h + filtre 1j — perp long/short | 1 (règles figées) + 27 en walk-forward | −0,032 R [−0,21 ; +0,16], PF 0,95, 314 trades | Rejetée |

| 2 | 2026-11-21 | donchian_trend 55/20 journalier — spot long | 1 (règles figées) + 27 | **+1,356 R [+0,31 ; +2,82]**, PF 4,29, 39 trades ; sans top 3 : +0,53 R ; coûts ×2 : +1,30 R | **Activée (spot long)** |
| 2 | 2026-11-21 | donchian_trend 55/20 journalier — perp long/short | 1 (règles figées) + 27 | +0,632 R [+0,09 ; +1,35], PF 2,47, 69 trades ; shorts seuls : +0,19 R [−0,24 ; +0,67] ; funding −37 R | Critères passés, **shorts non activés** (non significatifs) |

| 3 | 2026-11-22 | range_reversion 4h (filtre ADX 1j < 20) — spot long | 1 + 27 | −0,054 R [−0,31 ; +0,22], PF 0,90, 80 trades ; 7 % des réglages positifs | Rejetée |
| 3 | 2026-11-22 | range_reversion 4h — perp long/short | 1 + 27 | −0,268 R [−0,41 ; −0,11], PF 0,60, 221 trades | Rejetée (perte significative) |
| 4 | 2026-11-22 | Donchian + volume ≥ 1,5× — spot | 1 + 27 | +1,503 R [+0,39 ; +3,11] vs base +1,356 ; Sharpe OOS 0,92 vs 0,91 | Critères passés, **non adopté** (effet négligeable, voir note) |
| 4 | 2026-11-22 | Donchian + volume — perp | 1 + 27 | +0,595 R vs base +0,632 | Rejeté (dégrade) |
| 5 | 2026-11-22 | Donchian + ADX ≥ 20 — spot | 1 + 27 | +1,104 R vs base +1,356 ; 2025-26 négatif | Rejeté (dégrade) |
| 5 | 2026-11-22 | Donchian + ADX ≥ 20 — perp | 1 + 27 | +0,540 R vs base +0,632 | Rejeté (dégrade) |
| — | 2026-11-22 | Score de confluence (validation, pas un essai de stratégie) | 1 | Spearman IS +0,57, **OOS −0,04** | **Non validé** : affiché indicatif, ne filtre rien |

Total de configurations confrontées à la période OOS : **280**.

## Note sur l'essai n°4 (filtre de volume)

Il passe tous les critères fixés à l'avance. Mais l'amélioration (Sharpe OOS +0,01, espérance
+0,15 R pour des IC de ±1,2 R, 4 trades OOS retirés) est indiscernable du bruit, au 5e essai
sur la même période. Mes critères de filtre n'imposaient pas de **taille d'effet minimale** :
c'est une faille, corrigée pour la suite (amélioration du Sharpe OOS ≥ 0,10 exigée). Conformément
à la règle « un ajout après coup ne peut que durcir le verdict », le filtre n'est pas adopté.

## Note sur le score de confluence

Fort pouvoir prédictif en in-sample (tiers haut +18,5 R vs tiers bas +1,6 R), **nul hors
échantillon** (tiers haut +0,92 R vs tiers bas +0,00 R, mais le tiers du milieu à +3,15 R).
Exemple d'école : un indicateur qui « marche » sur le passé connu et pas après. Il reste
affiché à titre indicatif ; chaque alerte journalise son score pour une réévaluation sur le
paper trading.

## Notes sur l'essai n°2 (à relire avant chaque revue mensuelle)

- Profil typique du suivi de tendance : trade médian **négatif** (−0,11 R), gains concentrés
  sur quelques grandes tendances. Des séries de 5 à 10 pertes d'affilée sont normales.
- **L'avantage décroît** : en spot, R total par année d'entrée 2023 : +33,6 · 2024 : +14,7 ·
  2025 : +2,0 · 2026 : +2,6. À surveiller de près en paper trading (phase 4).
- Sharpe OOS du portefeuille (0,91) ≈ celui de BTC détenu (0,93) : l'intérêt est le **drawdown**
  (−7,4 % contre −53 %), pas un meilleur rendement par unité de risque.
- Échantillon par actif petit (12-14 trades OOS) : les statistiques par actif affichées dans
  les alertes sont indicatives, seules les statistiques agrégées ont un sens statistique.
- Deux critères (concentration, coûts ×2) ont été ajoutés après la 1re exécution ; ils ne
  pouvaient que durcir le verdict.


## Smart money (phase 6, 2026-11-22)

- 200 candidats du classement Hyperliquid évalués avec les critères du cahier des charges :
  **0 retenu**. Motif principal : drawdown > 30 % (163/200 ; médiane 86-100 %).
- Deux bugs trouvés par le diagnostic sur données réelles et corrigés : part de martingale
  > 100 % (positions ouvertes avant la fenêtre) et copie sans plafond de levier.
- Mesure du drawdown corrigée en cours de route (la 1re version divisait la chute du PnL par
  la valeur du compte, faussée par les transferts) ; seuil inchangé. Modified Dietz donne la
  même conclusion.
- L'apport du smart money au score n'est PAS mesurable aujourd'hui (aucun portefeuille, et
  ~10 signaux Donchian par an). Chaque alerte journalise l'état smart money ; le rapport
  hebdomadaire compare le R des trades avec / sans smart money aligné dès 5 trades de chaque.
