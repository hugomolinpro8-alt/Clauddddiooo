# Décisions et limites connues

## Contexte qui a tout orienté

Pas de budget API, partiel dans deux semaines, un seul utilisateur, envie d'utiliser l'app sur téléphone. Le cahier des charges proposait Next.js + Prisma/SQLite + clé API Anthropic. On l'a adapté :

| Prévu | Retenu | Pourquoi |
|---|---|---|
| API Anthropic avec `ANTHROPIC_API_KEY` | Capacité `sample` d'un Artifact claude.ai | L'IA tourne sur l'abonnement Claude de l'étudiant : 0 € de plus, aucune clé à gérer ou à fuiter. |
| Next.js (App Router) + serveur | React + Vite, page unique (~3,3 Mo) | Un Artifact est une page statique, sans serveur. Ouvrable partout, sur mobile, sans rien installer. |
| SQLite + Prisma | Capacité `db` de claude.ai (privée par utilisateur) + copie dans `localStorage` | Persistance en ligne, multi-appareils, sans hébergement. |
| shadcn/ui | Petits composants maison dans le même esprit (Tailwind) | shadcn s'installe via sa CLI et Radix. Pour une dizaine de composants, ce n'était pas rentable. |
| Prompt caching sur le cours | Cache de réponses de la plateforme (5 min) + textes envoyés seulement quand c'est utile | `sample` ne permet pas de piloter le prompt caching de l'API. Les flashcards, le planning et la prévision ne font aucun appel. |
| Sorties structurées via *tool use* | `sample.json` + validation Zod + une relance de réparation avec les erreurs | Même garantie de format côté code, avec l'outil disponible ici. |

`npm install && npm run dev` fonctionne toujours en local, avec l'IA simulée.

## Principes

- **L'IA analyse et rédige, le code calcule.** Le planning, la priorisation, SM-2, la maîtrise et la prévision sont déterministes et testés (`tests/`). Le plan ne dépend pas de l'humeur du modèle, et la note prévue n'est pas une boîte noire : sa formule est affichée dans l'écran Suivi.
- **Rien ne se perd.** La réponse de l'étudiant (copie, message d'onboarding, réponses d'examen blanc) est enregistrée *avant* l'appel IA. Un échec affiche un message en français et un bouton « Réessayer ». L'examen blanc reprend la correction là où elle s'est arrêtée.
- **Exactitude.** Chaque exercice généré et chaque correction passe par un second appel de vérification indépendant. Quand c'est calculable (dérivée, limite, égalité, valeur), mathjs recalcule de son côté. En cas de désaccord, un badge « à vérifier » s'affiche. Les citations du cours sont recherchées dans le texte source : « citation retrouvée » ou non.

## Formules (réglages par défaut)

- **Priorité** d'une notion = poids dans les annales × (1 − maîtrise/100).
- **Poids** = 0,7 × part des points + 0,3 × part des apparitions dans les annales, avec un plancher de 2 %, puis normalisé. Modifiable dans le rapport.
- **Besoin** = heures estimées × (maîtrise cible − maîtrise)/100 × 1,2. Maîtrise cible = note visée × 5 + 10, bornée entre 60 et 95.
- **Triage** : si besoin > temps alloué, on garde les notions par rendement décroissant (points gagnables par heure). Les autres passent en « flashcards seulement », avec une raison écrite.
- **Multi-matières** : chaque créneau de 50 min va à la matière qui a le plus grand coefficient × besoin restant / jours restants, avec un amortissement pour ne pas tout mettre sur une matière dans la journée.
- **Structure** : flashcards 20 min par jour par matière, créneaux de 50 min + 10 min de pause, rappels espacés à J+1, J+3 et J+7 après la première séance d'une notion, pas deux fois la même notion principale dans une journée, examen blanc à J-3 (sinon J-2 ou J-4), jour tampon à 60 % de la capacité si au moins 7 jours de travail, veille limitée aux fiches et aux flashcards (≤ 90 min).
- **Maîtrise** : a priori selon le niveau ressenti (10/30/50/70/85, poids 2) ; essais pondérés (flashcard 0,5, exercice 1, annale 1,5, examen blanc 2) avec une demi-vie de 14 jours ; oubli : × (0,75 + 0,25·e^(−t/S)), avec S = 2 × 1,5^réussites jours.
- **Prévision** : 20 × Σ poids × maîtrise. Fourchette ± 1,28 σ (80 %), où σ combine la variance par notion p(1−p)/(n+2) et 1 point d'erreur de modèle. Un examen blanc de moins de 14 jours compte pour 40 %.
- **Stagnation** : au moins 3 essais en 7 jours, moins de 5 points de progrès et score < 70 %. La notion repasse alors en mini-cours.
- **SM-2** : algorithme standard (EF ≥ 1,3 ; intervalles 1, 6, puis × EF). Un intervalle qui dépasserait le partiel est plafonné pour que la carte revienne avant.

## Défauts choisis sans demander

- Disponibilités par défaut : 5 h par jour en semaine, 6 h le samedi, 3 h le dimanche, à partir de 9 h. Modifiables à l'onboarding et dans Planning.
- Le plan se recalcule tout seul à la première ouverture de la journée s'il y a du retard, et après un check-in si le temps réel diffère d'au moins 30 min du prévu.
- Les flashcards sont générées sans IA à partir des définitions et théorèmes extraits du cours. On peut en ajouter à la main.
- Les photos de copie sont envoyées pour la correction mais **pas conservées** (seul le texte est stocké), pour rester dans les quotas de stockage.
- PDF scannés : transcription limitée aux 30 premières pages par document.

## Limites connues

- **L'IA n'est disponible que dans claude.ai.** En local ou dans un fichier ouvert hors claude.ai, les réponses sont simulées (bandeau visible).
- **Quotas** : un usage très intensif peut atteindre la limite de l'abonnement Claude. L'app l'affiche et l'étudiant réessaie plus tard.
- **Un seul calcul symbolique simple** : mathjs vérifie les dérivées, limites (numériquement), égalités et valeurs. Il ne vérifie ni les preuves, ni les récurrences, ni le raisonnement économique. Ceux-là reposent sur la contre-correction par Claude.
- **Taille des documents** : un appel accepte environ 256 Ko de texte. Un cours entier très long doit être importé en plusieurs fichiers (par chapitre).
- **Fusion après ré-analyse** : les notions sont rapprochées par titre. Si Claude renomme une notion, son historique d'essais n'est pas rattaché à la nouvelle.
- **La prévision** est un modèle simple et explicite, pas une garantie : elle ne voit ni le stress, ni un sujet atypique, ni le barème réel du correcteur.
- **Pas de vrai multi-utilisateurs** : l'app est pensée pour un seul étudiant (chaque visiteur aurait de toute façon son propre espace privé).
- Le test de bout en bout (`npm run e2e`) tourne en IA simulée : la qualité réelle des analyses et des corrections se juge dans claude.ai.
