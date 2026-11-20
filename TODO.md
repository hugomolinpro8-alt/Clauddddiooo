# TODO — contenus à compléter

Tout ce qui est marqué `[À REMPLIR]` (ou `[À BRANCHER]`) dans le site est listé ici.
Rien n'a été inventé : aucune caractéristique technique, aucun avis, aucune information légale.

> Astuce : `grep -rn "À REMPLIR" app components lib data` retrouve toutes les occurrences.

## 1. Produits — `data/products.json`

Pour **chacun des 6 masques** (`MODÈLE 01` à `MODÈLE 06` sont des noms neutres provisoires) :

- [ ] `nom` et `modele` : vrai nom du modèle (ex. « Masque Red Bull SPECT [MODÈLE] »)
- [ ] `slug` : identifiant d'URL (ex. `strive`), utilisé dans `/collection?modele=strive` et `/produit/strive`
- [ ] `coloris`
- [ ] `prix` : **les prix actuels sont des exemples**
- [ ] `etat` / `stock` : les valeurs actuelles servent à montrer les badges (« Pièce unique », « Vendu »)
- [ ] `couleurVerre`, `categorieVerre` (S0 à S4), `taille` : **valeurs d'exemple à vérifier**
- [ ] `accroche`, `description`
- [ ] `caracteristiques` : 6 lignes `[À REMPLIR]` (écran, verre, ventilation, mousse, sangle, compatibilité casque)
- [ ] `couleurDAmbiance` : couleur de fond du carrousel (déjà proposée, à ajuster)
- [ ] `teinteVerre` : teinte des visuels générés et du masque 3D procédural
- [ ] `variantes` (facultatif) : une ligne par pièce réelle si un même modèle/coloris existe en plusieurs états (voir `gg-01`)
- [ ] Photos réelles (voir `public/products/README.md`)
- [ ] `modele3d` : chemin d'un `.glb` si vous en avez un (sinon le masque 3D procédural est affiché)

## 2. Boutique — `lib/config.ts`

- [ ] `SITE.email` : adresse de contact
- [ ] `SITE.url` (ou variable `NEXT_PUBLIC_SITE_URL`) : domaine définitif
- [ ] `RESEAUX` : liens Instagram / TikTok / YouTube (actuellement `#`)
- [ ] `LIVRAISON.zones` : tarifs, seuils de gratuité et délais (**montants d'exemple**)

## 3. Contenus éditoriaux — `lib/contenu.ts`

- [ ] `CITATION.texte` et `CITATION.signature` (ouverture de la page Technologie)
- [ ] `ETAPES` : texte des 6 étapes (Écran, Verre, Anti-buée, Ventilation, Mousse et confort, Sangle et compatibilité casque)
- [ ] `ARGUMENTS` : 3 arguments du bandeau défilant
- [ ] `FAQ` : processus de vérification d'authenticité, définition des états, transporteurs/délais/tarifs, conditions de retour, conseils d'entretien

## 4. Fiche produit — `components/product/FicheProduit.tsx`

- [ ] Guide des tailles : tour de tête et profil pour S / M / L

## 5. Pages légales (à faire valider par un professionnel)

- [ ] `app/mentions-legales/page.tsx` : raison sociale, forme juridique, capital, adresse, SIREN/SIRET, RCS/RNE, TVA, téléphone, directeur de la publication, hébergeur, prestataire de paiement, médiateur de la consommation
- [ ] `app/cgv/page.tsx` : date de version, régime de TVA (régime de la marge pour l'occasion ?), moyens de paiement, délais/tarifs de livraison, frais de retour, durée de garantie pour l'occasion, formulaire de rétractation (coordonnées)
- [ ] `app/confidentialite/page.tsx` : responsable du traitement, destinataires, durées de conservation
- [ ] `app/contact/page.tsx` : délai de réponse

## 6. À brancher (volontairement non fait pour l'instant)

- [ ] Formulaire de contact (`components/pages/ContactForm.tsx`) : aucun envoi — à relier à un service (e-mail, Formspree, Brevo…)
- [ ] Newsletter (`components/ui/NewsletterForm.tsx`) : aucun envoi — à relier à Shopify (consentement marketing), Brevo, Klaviyo…
- [ ] Shopify : renseigner `.env` (voir README) et créer les produits/variantes/métachamps

## 7. Visuels

- [ ] Photos produits réelles : `public/products/<slug>/` (voir `public/products/README.md`)
- [ ] Scènes de fond : `public/scenes/` (voir `public/scenes/README.md`)
- [ ] Image de partage : régénérer `public/og.png` après changement (`node scripts/generate-og.mjs`)
