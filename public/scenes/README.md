# Scènes de fond

Les fichiers `.svg` actuels sont des **placeholders** (dégradés + montagnes). Remplacez-les par vos photos
(haute montagne, neige, lumière froide du matin…). Gardez le même nom, ou changez le chemin dans le code
(`lib/contenu.ts` pour la page Technologie, `components/home/Intro.tsx` et `components/carousel/GoggleCarousel.tsx`).

| Fichier | Où | Taille conseillée | Format |
|---|---|---|---|
| `intro.svg` | fond flou de l'intro d'accueil, ouverture Technologie, image de partage | **2400 × 1350 px** | JPG/WebP, < 400 Ko |
| `carrousel.svg` | texture discrète derrière les masques (fortement atténuée) | **2400 × 1350 px** | JPG/WebP, < 300 Ko |
| `technologie-01.svg` … `technologie-06.svg` | scène plein écran de chaque étape (01 Écran … 06 Sangle) | **2400 × 1600 px** (paysage) — prévoir un sujet centré, recadré en portrait sur mobile | JPG/WebP, < 450 Ko |

Conseils :
- Images **horizontales**, sujet au centre (elles sont recadrées en `object-cover`).
- Le bas de chaque scène Technologie est assombri par un dégradé pour la lisibilité du texte : évitez d'y placer le sujet.
- Si vous passez en JPG/WebP, retirez la prop `unoptimized` des `<Image>` correspondants pour profiter de l'optimisation automatique.
