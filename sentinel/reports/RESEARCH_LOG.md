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

Total de configurations confrontées à la période OOS : **112**.

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
