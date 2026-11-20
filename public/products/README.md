# Photos produits

Un dossier par produit, nommé comme son `slug` dans `data/products.json` :

```
public/products/<slug>/
├── detoure.png        ← photo détourée du carrousel (OBLIGATOIRE)
├── photo-1.webp       ← galerie de la fiche produit (autant que vous voulez)
├── photo-2.webp
├── …
├── 360/               ← séquence 360° (facultative)
│   ├── 01.webp
│   ├── 02.webp
│   └── … 24.webp
└── modele.glb         ← modèle 3D (facultatif)
```

## Photo détourée (carrousel, grille, panier)

| Réglage | Valeur |
|---|---|
| Format | **PNG transparent** (ou WebP avec transparence) |
| Taille | **1600 × 1000 px** (ratio 16:10) |
| Cadrage | masque de face, centré, sangle comprise, **marge de ~6 %** autour |
| Fond | totalement transparent, sans ombre (l'ombre est ajoutée par le site) |
| Poids | < 600 Ko (le site génère automatiquement AVIF/WebP optimisés) |

Le site incline déjà le masque de quelques degrés : photographiez-le bien droit.

## Galerie (fiche produit)

- **1600 × 1600 px** (carré), JPG ou WebP, qualité 80–85.
- Fond neutre clair conseillé, lumière douce. Photographiez les défauts éventuels (pièces d'occasion).
- Listez les chemins dans `photos` (le premier sert aussi d'image de partage).

## Séquence 360°

- Photos prises sur plateau tournant, appareil fixe, **même cadrage et même exposition**.
- **24 images** (une tous les 15°) — 36 pour plus de fluidité — numérotées `01`, `02`, … dans `360/`.
- **1200 × 750 px**, WebP, fond transparent ou uni.
- Dans `products.json` : `"sequence360": { "dossier": "/products/<slug>/360", "images": 24, "extension": "webp" }`.
- Pas de séquence ? Mettez `"sequence360": null` : l'onglet 360° disparaît.

## Modèle 3D (.glb)

- Format **glTF binaire (.glb)**, < 5 Mo idéalement (compression Draco acceptée par le chargeur).
- Origine au centre du masque, face avant orientée vers **+Z**, unité quelconque (le site recentre).
- Dans `products.json` : `"modele3d": "/products/<slug>/modele.glb"`.
- Sans `.glb`, le site affiche un masque 3D procédural teinté avec `teinteVerre`.

## Régénérer les placeholders

`npm run assets` recrée les visuels manquants (n'écrase jamais vos fichiers ; `--force` pour tout régénérer).
