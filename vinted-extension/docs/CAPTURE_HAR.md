# Capturer les requêtes Vinted (fichier HAR)

Vinted n'a pas d'API publique. Pour que l'extension fasse **exactement** ce que
fait le site quand vous cliquez, il faut observer les requêtes que votre
navigateur envoie pendant que vous faites les actions **à la main**. Chrome
peut enregistrer tout ça dans un fichier `.har`.

Comptez environ 15 minutes.

---

## ⚠ Avant de commencer : sécurité

Un fichier `.har` **brut** contient vos cookies de session : avec, n'importe qui
peut se connecter à votre compte Vinted sans mot de passe.

- **Ne l'envoyez jamais tel quel** à personne (ni à moi, ni sur un forum).
- Passez-le d'abord dans l'outil d'anonymisation fourni (étape 5) et ne
  partagez **que le rapport** `.rapport.md` qu'il produit.
- Supprimez le `.har` une fois le rapport généré.
- Le fichier `.gitignore` du projet empêche déjà d'envoyer un `.har` sur GitHub par erreur.

---

## Étape 1 — Ouvrir les DevTools sur Vinted

1. Ouvrez Chrome et connectez-vous à **www.vinted.fr** comme d'habitude.
2. Appuyez sur **F12** (Mac : **Cmd + Option + I**). Un panneau s'ouvre.
3. Cliquez sur l'onglet **Network** (ou **Réseau**).

## Étape 2 — Régler l'enregistrement

Dans la barre en haut du panneau Network :

1. Cochez **Preserve log** (« Conserver le journal ») : sinon, tout s'efface à
   chaque changement de page.
2. Cochez **Disable cache** (« Désactiver le cache »).
3. Cliquez sur le filtre **Fetch/XHR** : on ne voit plus que les échanges de
   données, sans les images ni les scripts.
4. Vérifiez que le rond en haut à gauche est **rouge** (enregistrement en
   cours). Cliquez sur 🚫 (« Clear ») pour partir d'une liste vide.

## Étape 3 — Faire les actions à la main, dans cet ordre

Faites chaque action **une seule fois**, calmement, en attendant que la page
ait fini de charger avant la suivante. L'ordre aide à reconnaître les requêtes.

**A. Lecture (pour le tableau de bord)**

1. Allez sur **votre profil** (votre dressing) et faites défiler jusqu'à la
   page 2 de vos annonces si vous en avez plusieurs.
2. Ouvrez **une de vos annonces** (la page de l'article).

**B. Republication (étape 2)** — utilisez un **article test sans valeur**
(ex. un vieux t-shirt), pas une vraie annonce qui a des favoris :

3. Cliquez sur **Modifier** sur cette annonce, puis quittez **sans enregistrer**
   (cela montre comment Vinted fournit toutes les infos d'une annonce :
   catégorie, taille, état, marque…).
4. Cliquez sur **Vendre** et créez une **nouvelle annonce test** complète :
   1 ou 2 photos, titre, description, catégorie, marque, taille, état, prix.
   Publiez-la.
5. Ouvrez cette nouvelle annonce test pour vérifier qu'elle est en ligne.
6. **Supprimez** cette annonce test (Modifier → Supprimer).

**C. Favoris et messages (étape 3)**

7. Ouvrez vos **notifications** (la cloche) et repérez une notification
   « … a ajouté votre article à ses favoris » (s'il n'y en a pas, demandez à
   un proche de mettre un de vos articles en favori avant la capture).
8. Ouvrez votre **messagerie** puis une conversation existante.
9. Envoyez un **message** à quelqu'un (par exemple à ce proche) depuis la page
   d'un de vos articles mis en favori.
10. Faites une **offre** (proposer un prix réduit) dans cette conversation,
    si l'option est proposée.

## Étape 4 — Enregistrer le fichier HAR

1. Arrêtez l'enregistrement (cliquez sur le rond rouge).
2. Cliquez sur l'icône **⬇ (Export HAR)** dans la barre du panneau Network
   (ou clic droit sur la liste → **Save all as HAR**).
   - Si Chrome propose **« Export HAR (sanitized) »**, choisissez-le : il
     retire déjà une partie des cookies. **Il faut quand même passer l'étape 5.**
3. Enregistrez le fichier, par exemple `vinted.har`, dans le dossier
   `vinted-extension`.

## Étape 5 — Anonymiser et produire le rapport

Il faut **Node.js** (voir le README, section « Prérequis »).

1. Ouvrez un terminal dans le dossier `vinted-extension`
   (Windows : dans l'explorateur, cliquez dans la barre d'adresse, tapez
   `cmd` puis Entrée ; Mac : clic droit sur le dossier → « Nouveau terminal au dossier »).
2. Tapez :

   ```
   node tools/analyze-har.mjs vinted.har
   ```

3. Deux fichiers apparaissent : `vinted.rapport.md` (lisible) et
   `vinted.rapport.json`.
4. **Ouvrez `vinted.rapport.md` et relisez-le** : vous devez y voir des
   chemins comme `POST /api/v2/...` et des structures comme
   `"title": "<texte 18 car.>"`, mais **aucun** de vos textes, e-mails,
   noms ou cookies. Les cookies et jetons apparaissent comme `[masqué]`.
5. Envoyez-moi le contenu de `vinted.rapport.md`, puis **supprimez `vinted.har`**.

## Ce que je ferai avec le rapport

Pour chaque fonction, j'identifierai la requête exacte (méthode, chemin,
format du corps, en-têtes nécessaires) :

| Besoin | Ce que je cherche dans le rapport |
|---|---|
| Lister vos annonces | `GET …/wardrobe/{id}/items` ou équivalent |
| Lire une annonce complète | `GET …/items/{id}` (photos, catégorie, taille, état, marque) |
| Recréer une annonce | envoi des photos (`…/photos`) puis création (`POST …/items`) |
| Vérifier qu'elle est en ligne | `GET …/items/{id}` sur la nouvelle |
| Supprimer l'ancienne | `POST …/items/{id}/delete` ou `DELETE …` |
| Détecter les favoris | notifications (`…/notifications`) |
| Envoyer un message / une offre | conversations (`…/conversations`, `…/offers`) |

Ces chemins seront ensuite inscrits dans `src/lib/endpoints.js` (ou dans la
section « Endpoints avancés » des options) avec le statut `confirme`.

## En cas de souci pendant la capture

- **Un captcha ou une vérification apparaît** : faites-la normalement, à la
  main. C'est utile : ça me montre à quoi ressemble ce blocage, pour que
  l'extension le reconnaisse et s'arrête.
- **La liste est vide** : vérifiez que le filtre **Fetch/XHR** est actif et
  que **Preserve log** est coché, puis recommencez.
