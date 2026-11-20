# GOGGLES — boutique de masques de ski

Site e-commerce immersif pour la revente de masques **Red Bull SPECT authentiques** (neufs ou d'occasion).
GOGGLES est un **revendeur indépendant, non affilié à Red Bull**.

- **Stack** : Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · GSAP (ScrollTrigger, SplitText) · Lenis · Framer Motion · React Three Fiber
- **Paiement** : Shopify headless (Storefront API), avec un **mode démo** sans Shopify (catalogue `data/products.json`, panier local)

---

## Démarrer

```bash
npm install
npm run dev
```

Puis ouvrez http://localhost:3000. Sans fichier `.env`, le site tourne en **mode démo**.

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement |
| `npm run build` puis `npm start` | version de production |
| `npm run lint` / `npm run typecheck` | vérifications |
| `npm run assets` | régénère les visuels de remplacement manquants (icônes, photos, 360°, scènes) |
| `node scripts/generate-og.mjs` | régénère l'image de partage `public/og.png` (nécessite Playwright) |

---

## Ce que contient le site

| Page | Points clés |
|---|---|
| `/` Accueil | loader avec animation du logo (1×/session) → intro floue animée → transition « zoom + mise au point » → carrousel ; carte newsletter fermable, bouton « Voir la technologie », réseaux |
| `/collection` | **carrousel des masques** (glisser au doigt/souris, molette/trackpad horizontal, flèches clavier, boutons, miniatures, compteur, barre de progression, boucle infinie, URL partageable `?modele=…`) + bouton « Voir en grille » (filtres modèle / couleur du verre / catégorie S1–S4 / état / taille, tri par prix) |
| `/produit/[slug]` | galerie photos, **vue 360°** (séquence d'images) et **vue 3D** (votre `.glb` ou masque procédural), variantes, achat collant sur mobile, caractéristiques, guide des tailles, livraison/retours, mentions obligatoires, avis (vide), « Les autres masques » |
| `/technologie` | citation, navigation 01–06, 6 scènes plein écran avec texte révélé mot à mot, bandeau défilant, FAQ |
| `/faq`, `/contact`, `/favoris`, `/mentions-legales`, `/cgv`, `/confidentialite` | pages de contenu (placeholders à valider) |

Partout : en-tête (logo, favoris, panier avec compteur, menu plein écran, bouton Contact), tiroir panier,
bandeau cookies RGPD (« Tout refuser » aussi simple que « Tout accepter »), `prefers-reduced-motion` respecté.

---

## Remplacer les photos

Les visuels actuels sont des **placeholders originaux** (silhouette de masque dessinée), jamais des images de la marque.

1. Créez/remplacez les fichiers dans `public/products/<slug>/` :
   - `detoure.png` — **PNG transparent 1600 × 1000 px**, masque de face centré, marge ~6 %, sans ombre
   - `photo-1.webp`, `photo-2.webp`… — **1600 × 1600 px**
   - `360/01.webp` … `360/24.webp` — séquence 360° **1200 × 750 px** (facultatif)
   - `modele.glb` — modèle 3D (facultatif)
2. Mettez à jour les chemins dans `data/products.json` si vous changez les noms.

Tous les détails (cadrage, poids, prise de vue 360°, export .glb) : **`public/products/README.md`**.
Scènes de fond (tailles et formats) : **`public/scenes/README.md`**.

---

## Ajouter un produit

Une fiche = **un modèle + un coloris**. Ajoutez un objet dans `data/products.json` :

```jsonc
{
  "id": "gg-07",                         // identifiant unique
  "slug": "mon-modele",                  // URL : /produit/mon-modele et /collection?modele=mon-modele
  "nom": "Masque Red Bull SPECT MON MODÈLE",
  "modele": "MON MODÈLE",                // affiché en géant dans le carrousel
  "coloris": "Noir mat / verre orange",
  "prix": 179,
  "etat": "tres-bon-etat",               // neuf-avec-etiquette | neuf-sans-boite | tres-bon-etat | bon-etat
  "stock": 1,                            // 1 → badge « Pièce unique », 0 → « Vendu »
  "couleurDAmbiance": "#2C5D8F",         // fond du carrousel pour ce masque
  "teinteVerre": "#FF8A3D",              // teinte des visuels générés et de la 3D procédurale
  "couleurVerre": "Orange",
  "categorieVerre": "S2",                // S0 à S4
  "taille": "M",
  "accroche": "…",
  "description": "…",
  "caracteristiques": ["Écran : …", "Verre : …"],
  "photos": ["/products/mon-modele/photo-1.webp"],
  "photoDetouree": "/products/mon-modele/detoure.png",
  "sequence360": { "dossier": "/products/mon-modele/360", "images": 24, "extension": "webp" },  // ou null
  "modele3d": null,                      // ou "/products/mon-modele/modele.glb"
  "variantes": [                         // facultatif : une entrée par pièce réelle
    { "id": "gg-07-a", "etat": "neuf-avec-etiquette", "stock": 1, "prix": 199, "couleurVerre": "Orange", "categorieVerre": "S2", "taille": "M" },
    { "id": "gg-07-b", "etat": "bon-etat",            "stock": 1, "prix": 129, "couleurVerre": "Orange", "categorieVerre": "S2", "taille": "M" }
  ]
}
```

Sans `variantes`, la fiche utilise directement `etat`, `stock`, `prix`, etc.
Lancez `npm run assets` pour générer des placeholders pour ce nouveau produit en attendant vos photos.

---

## Brancher Shopify

1. Dans Shopify : **Paramètres → Applications → Développer des applications** (ou l'app *Headless*) → créez une app avec l'accès **Storefront API** et les autorisations :
   `unauthenticated_read_product_listings`, `unauthenticated_read_product_inventory`, `unauthenticated_write_checkouts`, `unauthenticated_read_checkouts`.
2. Copiez `.env.example` en `.env.local` et remplissez :
   ```bash
   NEXT_PUBLIC_COMMERCE_MODE=shopify
   SHOPIFY_STORE_DOMAIN=ma-boutique.myshopify.com
   SHOPIFY_STOREFRONT_ACCESS_TOKEN=xxxxxxxx
   SHOPIFY_API_VERSION=2026-10
   NEXT_PUBLIC_SITE_URL=https://www.mon-domaine.fr
   ```
3. Dans Shopify, pour chaque produit :
   - **Handle** = le `slug` du site (ex. `modele-01`) → les visuels locaux (détourée, 360°, 3D) sont repris automatiquement ;
   - **Options de variante** : `État` (valeurs : *Neuf avec étiquette*, *Neuf sans boîte*, *Très bon état*, *Bon état*), et si besoin `Couleur du verre`, `Catégorie de verre`, `Taille` ;
   - **Stock** suivi par Shopify (1 pour une pièce unique) ;
   - **Métachamps** facultatifs (namespace `goggles`) : `couleur_ambiance`, `teinte_verre`, `modele`, `coloris`, `caracteristiques` (liste JSON). Dans la définition de chaque métachamp, cochez **« Accès Storefront »** pour qu'il soit lisible par le site.
4. Redémarrez le serveur. Le catalogue vient alors de Shopify (mis en cache 60 s), le bouton « Passer au paiement » crée un panier Shopify et redirige vers le **checkout Shopify** (paiement, taxes et frais de port définitifs).
   Tout champ absent côté Shopify est complété par `data/products.json` ; si Shopify est injoignable, le site repasse automatiquement sur le catalogue local.

Code concerné : `lib/commerce/shopify.ts` (catalogue + paiement), `lib/commerce/actions.ts` (action serveur de paiement).
Le jeton reste côté serveur.

---

## Déployer sur Vercel

1. Poussez le dépôt sur GitHub, puis sur https://vercel.com → **Add New… → Project** → importez le dépôt (framework détecté : Next.js).
2. **Environment Variables** : ajoutez celles de `.env.example` (au minimum `NEXT_PUBLIC_SITE_URL` ; les variables Shopify pour le mode boutique).
3. **Deploy**. Ajoutez ensuite votre domaine dans **Settings → Domains** et mettez `NEXT_PUBLIC_SITE_URL` à jour.

Le sitemap (`/sitemap.xml`), le `robots.txt`, le manifeste et l'image Open Graph sont générés automatiquement.

---

## Organisation du code

```
app/                 pages (App Router), sitemap, robots, manifest, 404
components/
  brand/Logo.tsx     logo en SVG inline (variant fonce/clair, symbole seul, animation)
  carousel/          carrousel des masques + carte d'infos + vue collection
  home/              loader, intro, carte newsletter, orchestration de l'accueil
  product/           fiche, galerie, Viewer360, Viewer3D, grille, cartes
  tech/              page Technologie
  layout/            en-tête, menu, pied de page, cookies, défilement fluide
  cart/              tiroir panier
lib/
  commerce/          types, catalogue (démo / Shopify), action de paiement
  config.ts          nom, mentions, réseaux, zones de livraison
  contenu.ts         textes éditoriaux (citation, étapes, arguments, FAQ)
  store.tsx          état global : UI, panier, favoris (localStorage)
data/products.json   catalogue démo
public/brand/        logos SVG + icônes PNG
public/products/     photos produits
public/scenes/       scènes de fond
```

## Identité

- Couleurs : bleu nuit `#0E1A2B`, blanc / neige `#F4F6F8`, gris glacier `#9FB3C8`, orange `#FF5A1F` (achat et éléments actifs uniquement), texte secondaire `#4A5A6D`.
- Polices (Google Fonts via `next/font`) : Anton (logo, titres), Inter (texte), Fraunces (citations).
- Le texte des boutons orange est en bleu nuit : le blanc sur cet orange n'atteint pas le contraste minimal WCAG AA pour du petit texte.

Ce qui reste à compléter : voir **`TODO.md`**.
