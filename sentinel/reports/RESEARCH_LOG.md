# Journal de recherche — registre des essais

Pourquoi ce fichier : chaque stratégie testée sur la même période hors échantillon (2023 → )
« use » un peu cette période. Après 20 essais, l'un d'eux passera les critères par pur hasard
(problème des tests multiples / data snooping). On note donc CHAQUE essai, y compris les
échecs, et les seuils d'activation se durciront avec le nombre d'essais.

| # | Date | Stratégie | Configurations évaluées | Résultat OOS (espérance nette, IC 95 %) | Décision |
|---|---|---|---|---|---|
| 1 | 2026-11-21 | trend_pullback 4h + filtre 1j — spot long | 1 (règles figées) + 27 en walk-forward | −0,003 R [−0,23 ; +0,24], PF 1,00, 185 trades | Rejetée |
| 1 | 2026-11-21 | trend_pullback 4h + filtre 1j — perp long/short | 1 (règles figées) + 27 en walk-forward | −0,032 R [−0,21 ; +0,16], PF 0,95, 314 trades | Rejetée |

Total de configurations confrontées à la période OOS : **56**.
