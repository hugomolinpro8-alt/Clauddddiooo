# Étape 1 — Capturer les requêtes Vinted (fichier HAR)

Objectif : enregistrer ce que fait ton navigateur quand tu **cherches** et quand tu
**achètes**, pour identifier les endpoints exacts utilisés par Vinted.

> ⚠️ **Un fichier HAR contient tes cookies de session** : quiconque l'a peut agir
> sur ton compte. Ne le partage jamais tel quel. Utilise l'outil de résumé caviardé
> (plus bas) et ne transmets que ce résumé. Les fichiers `*.har` sont ignorés par git.

Exemple avec Chrome ou Edge (Firefox : même principe, `F12` puis onglet *Réseau*).

## A. Capture de la recherche (sans risque)

1. Connecte-toi sur `https://www.vinted.fr` dans ton navigateur habituel.
2. Appuie sur `F12`, puis ouvre l'onglet **Network / Réseau**.
3. Coche **Preserve log / Conserver le journal**, puis clique sur 🚫 pour vider la liste.
4. Dans le champ de filtre, tape `api/v2`.
5. Fais une recherche, applique tes filtres (marque, taille, état, prix), puis trie par **Plus récents**.
6. Tu dois voir une requête `catalog/items?...order=newest_first...`. Clique dessus :
   - onglet **Headers** : note l'URL complète (*Request URL*) ;
   - *Request Headers* : la ligne `cookie:` et la ligne `user-agent:` servent pour le `.env` (voir README).
7. Exporte la capture : clic droit dans la liste, puis **Save all as HAR with content**. Enregistre sous `recherche.har`.

## B. Capture d'un achat (à faire une fois, sur un petit article)

Il n'existe pas d'achat « à blanc » : la capture doit couvrir un vrai achat. Choisis un
article pas cher que tu veux vraiment, ou arrête-toi juste avant le paiement (point 6).
Même partielle, cette capture montre déjà la création du checkout.

1. Ouvre l'annonce. DevTools ouverts, onglet *Réseau*, *Conserver le journal* coché, liste vidée.
2. Retire le filtre `api/v2` : certains appels d'achat passent par d'autres chemins.
3. Clique sur **Acheter**.
4. Sur la page de paiement, laisse l'adresse, le point relais et **le moyen de paiement déjà enregistrés**.
5. Note les requêtes qui apparaissent. Leurs chemins contiennent souvent `transaction`, `checkout`, `purchase`, `payment`, `shipping` ou `pickup`.
6. *(Optionnel, achat réel)* Clique sur **Payer**. Si ta banque demande une validation
   3-D Secure, valide-la normalement. Le bot ne pourra jamais le faire à ta place, et c'est voulu.
7. Exporte de la même façon sous `achat.har`.

## C. Produire le résumé caviardé à partager

```bash
python -m vwatch har recherche.har
python -m vwatch har achat.har
```

Chaque commande crée un fichier `*.resume.md` qui contient :

- la méthode, le chemin et le statut de chaque appel API Vinted, avec ⭐ pour ceux liés à l'achat ;
- la **structure** des corps envoyés et reçus. Les textes sont remplacés par `<texte N car.>`
  et les champs sensibles (jetons, e-mail, adresse, carte, nom…) par `[CAVIARDÉ]` ;
- les noms des en-têtes `x-…` utilisés (par ex. `x-csrf-token`), sans leurs valeurs.

**Relis le résumé** avant de me l'envoyer. S'il reste quoi que ce soit de personnel,
efface-le à la main.

## Ce que j'en ferai

- **Recherche** : vérifier que `/api/v2/catalog/items` et ses paramètres (`catalog_ids`,
  `brand_ids`, `size_ids`, `status_ids`, `price_from`, `price_to`, `order=newest_first`)
  correspondent à ta capture. Si ce n'est pas le cas, j'ajuste `vwatch/client.py`.
- **Achat** : écrire `vwatch/purchase_flow.py` (étape 5) à partir des appels ⭐ : création
  de la transaction, lecture du montant final, confirmation avec le moyen de paiement
  enregistré. Ce fichier reste volontairement vide tant que ta capture ne l'a pas validé.
