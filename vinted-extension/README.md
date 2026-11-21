# Vinted Dressing Assistant (extension Chrome)

Extension Chrome (Manifest V3) pour gérer votre dressing Vinted depuis **votre
session déjà connectée**. Elle ne stocke **aucun mot de passe**.

| Fonction | Statut |
|---|---|
| Architecture, sécurité (simulation, quotas, pause, arrêt d'urgence) | ✅ Étape 1 — terminée et testée |
| Tableau de bord (annonces, historique, logs) | ✅ Étape 1 (annonces en lecture seule) |
| Page d'options (quotas, plages horaires, modèles, remise) | ✅ Étape 1 |
| Outil de capture/anonymisation HAR | ✅ Étape 1 |
| Republication planifiée | ⏳ Étape 2 — attend votre rapport HAR |
| Messages aux favoris (+ offre optionnelle) | ⏳ Étape 3 — attend votre rapport HAR |

> **À savoir :** les conditions d'utilisation de Vinted encadrent
> l'automatisation. Même avec des quotas prudents, Vinted peut restreindre un
> compte qu'il juge automatisé. Vous utilisez cet outil sous votre
> responsabilité ; gardez des quotas bas.

---

## Installation pas à pas

### 1. Récupérer le dossier

Téléchargez ce dépôt (bouton vert **Code → Download ZIP** sur GitHub), puis
décompressez-le. Vous obtenez un dossier contenant `vinted-extension`.

### 2. Charger l'extension dans Chrome

1. Ouvrez Chrome et tapez dans la barre d'adresse : `chrome://extensions`
2. En haut à droite, activez **Mode développeur**.
3. Cliquez sur **Charger l'extension non empaquetée**.
4. Sélectionnez le dossier **`vinted-extension`** (celui qui contient `manifest.json`).
5. L'extension apparaît. Cliquez sur l'icône 🧩 de Chrome puis sur l'épingle 📌
   à côté de « Vinted Dressing Assistant » pour la garder visible.

La page d'options s'ouvre toute seule la première fois.

### 3. Premier test (sans aucun risque)

1. Ouvrez **www.vinted.fr** dans un onglet et vérifiez que vous êtes connecté.
   Si l'onglet était déjà ouvert avant l'installation, **rechargez-le (F5)**.
2. Cliquez sur l'icône de l'extension (badge bleu **SIM** = simulation).
3. Cliquez sur **Tester la connexion** : votre pseudo doit s'afficher.
4. Cliquez sur **Rafraîchir** dans l'onglet *Annonces* : vos annonces s'affichent.

Ces deux actions ne font que **lire**. Si l'une d'elles échoue (erreur 404 dans
l'onglet *Logs*), c'est normal à ce stade : les adresses exactes de Vinted
seront confirmées grâce à votre capture HAR (étape suivante).

### 4. Capturer les requêtes Vinted

Suivez le guide **[docs/CAPTURE_HAR.md](docs/CAPTURE_HAR.md)**, puis
envoyez-moi le rapport anonymisé. Je pourrai alors écrire les étapes 2 et 3.

### Mettre à jour l'extension après une modification

Sur `chrome://extensions`, cliquez sur la flèche ↻ de la carte de
l'extension, puis rechargez vos onglets Vinted.

---

## Utilisation

### La popup (tableau de bord)

- **Badge** sur l'icône : `SIM` (bleu) simulation · `II` (gris) pause ·
  `STOP` (rouge) arrêt d'urgence · rien = mode réel actif.
- **Pause générale** : stoppe immédiatement toute activité.
- **Onglets** : Annonces · Republications · Messages · Logs.

### Le mode simulation (activé par défaut)

En simulation, l'extension **lit** vos données mais n'**écrit** jamais rien
sur Vinted. Chaque action qu'elle *aurait* faite apparaît dans les logs, en
bleu, préfixée par `[SIMULATION]`, en respectant les mêmes quotas que le
mode réel : vous voyez exactement le rythme qui serait suivi.

Pour passer en mode réel : Options → décocher « Mode simulation » →
Enregistrer → confirmer.

### Les protections

| Protection | Fonctionnement |
|---|---|
| Quotas | Au plus N actions par heure et M par 24 h (glissantes). Plafonds non dépassables : 30/h, 150/24 h. |
| Délai minimum | Au moins X secondes entre deux actions (minimum imposé : 30 s). |
| Pause générale | Un clic dans la popup, tout s'arrête. |
| Arrêt d'urgence | Sur **403, 429, 401**, captcha, page de vérification, réponse HTML inattendue ou 3 erreurs serveur d'affilée : tout s'arrête, notification + badge `STOP`. |
| Reprise | Uniquement manuelle, depuis la popup, avec confirmation. |
| Aucun contournement | L'extension ne réessaie pas, ne modifie pas ses en-têtes et ne touche jamais aux captchas. |

En cas d'arrêt d'urgence : ouvrez Vinted, regardez ce qui s'affiche (captcha,
demande de vérification…), réglez-le **vous-même**, attendez quelques heures,
et baissez vos quotas avant de relancer.

---

## Architecture

```
vinted-extension/
├── manifest.json               Déclaration de l'extension (permissions minimales)
├── src/
│   ├── background/
│   │   ├── service-worker.js   Cerveau : planification (chaque minute), commandes de la popup
│   │   └── api.js              Point de passage UNIQUE vers Vinted : simulation, quotas, arrêt d'urgence
│   ├── content/
│   │   └── bridge.js           Pont injecté dans les onglets Vinted : envoie les requêtes avec
│   │                           votre session, détecte les captchas affichés
│   ├── lib/                    Logique pure (testée automatiquement)
│   │   ├── config.js           Réglages par défaut + bornes de sécurité
│   │   ├── quota.js            Limiteur d'actions
│   │   ├── guard.js            Détection 403/429/captcha/vérification
│   │   ├── endpoints.js        Catalogue des requêtes Vinted (à confirmer par HAR)
│   │   ├── items.js            Lecture des annonces
│   │   ├── schedule.js         Plages horaires
│   │   ├── template.js         Modèles de messages et calcul de remise
│   │   └── storage.js          Sauvegarde locale (chrome.storage)
│   ├── popup/                  Tableau de bord
│   └── options/                Page d'options
├── tools/
│   ├── analyze-har.mjs         Anonymise un HAR et liste les endpoints
│   └── make-icons.mjs          Génère les icônes
├── tests/
│   ├── unit/                   Tests de la logique (node --test)
│   ├── e2e/                    Test de l'extension réelle face à un faux Vinted
│   └── fixtures/sample.har     HAR d'exemple (données fictives)
└── docs/CAPTURE_HAR.md         Guide de capture des requêtes
```

**Comment la session est utilisée.** Le service worker ne contacte jamais
Vinted directement : il demande au *pont* (`bridge.js`), qui tourne dans
votre onglet Vinted ouvert, d'envoyer la requête. Elle part donc de la page
Vinted elle-même, avec vos cookies, comme un clic normal. C'est pourquoi **un
onglet Vinted connecté doit rester ouvert** pour que l'extension travaille.

**Où sont les données ?** Uniquement dans votre navigateur
(`chrome.storage.local`). Rien n'est envoyé ailleurs que sur Vinted.

---

## Pour les tests (facultatif)

Prérequis : [Node.js](https://nodejs.org) version 20 ou plus (installeur
« LTS »). Aucune bibliothèque à installer pour les tests unitaires.

```
cd vinted-extension
npm test              # 32 tests de la logique (quotas, détection, modèles, HAR…)
npm run test:e2e      # charge l'extension dans Chromium face à un faux Vinted
```

Le test e2e nécessite Playwright (`npm install -g playwright` puis
`npx playwright install chromium`). Il ne contacte jamais le vrai Vinted :
toutes les requêtes sont interceptées.
