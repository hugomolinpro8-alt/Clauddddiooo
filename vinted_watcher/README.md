# Vinted Watcher

Surveille les nouvelles annonces Vinted selon tes filtres et t'envoie sur Telegram une
photo, le prix, la taille, l'état et un lien direct vers l'appli. Des boutons
**Acheter / Ignorer** accompagnent chaque annonce. L'achat automatique est optionnel,
encadré par des garde-fous, et tourne **en simulation par défaut**.

| Étape | Contenu | État |
|---|---|---|
| 1 | Capture des endpoints (HAR) + outil de résumé caviardé | ✅ [docs/CAPTURE_HAR.md](docs/CAPTURE_HAR.md) |
| 2 | Surveillance + filtres + historique SQLite | ✅ |
| 3 | Notifications Telegram + boutons + commandes | ✅ |
| 4 | Achat en **simulation** avec tous les garde-fous | ✅ |
| 5 | Achat **réel** | 🔒 en attente de ta capture HAR d'achat |

> **À savoir avant de commencer.** Les conditions d'utilisation de Vinted interdisent
> l'automatisation. Un usage trop insistant peut mener à des vérifications, voire à la
> suspension du compte. L'outil est conçu pour rester discret : 30 s minimum entre deux
> requêtes d'une même recherche, aucune rotation de proxy, aucune résolution de captcha,
> et une pause automatique dès que Vinted bloque. Tu restes responsable de l'usage
> que tu en fais.

---

## 1. Installation

Il faut Python 3.10 ou plus récent.

```bash
cd vinted_watcher
python3 -m venv .venv
source .venv/bin/activate          # Windows : .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # Windows : copy .env.example .env
cp config.example.yaml config.yaml
```

`.env`, `config.yaml`, `data/`, `logs/` et `*.har` sont ignorés par git.

## 2. Ta session Vinted (cookies, jamais de mot de passe)

1. Connecte-toi sur vinted.fr dans ton navigateur.
2. `F12`, onglet **Réseau**, filtre `api/v2`, puis recharge une page de recherche.
3. Clique sur une requête `catalog/items` et descends jusqu'à *Request Headers*.
4. Copie **toute** la valeur de `cookie:` dans `VINTED_COOKIES='...'` de ton `.env`.
5. Copie la valeur de `user-agent:` dans `VINTED_USER_AGENT='...'`. Elle doit venir du
   même navigateur : Vinted associe la session à ce navigateur.

Les jetons renouvelés par Vinted sont conservés dans `data/session_cookies.json`. Quand
la session expire, le bot se met en pause et te prévient sur Telegram. Tu réexportes
alors les cookies dans `.env` et tu envoies `/resume` : le bot les recharge sans redémarrer.

## 3. Le bot Telegram

1. Sur Telegram, écris à **@BotFather**, envoie `/newbot` et suis les instructions.
   Copie le jeton dans `TELEGRAM_BOT_TOKEN`.
2. Envoie un message quelconque à ton nouveau bot.
3. Ouvre `https://api.telegram.org/bot<TON_JETON>/getUpdates` dans un navigateur.
   Recopie la valeur de `"chat":{"id": ...}` dans `TELEGRAM_CHAT_ID`.
4. Teste l'envoi :

```bash
python -m vwatch test-telegram
```

Le bot n'obéit qu'à ce `chat_id`. Les messages d'autres personnes sont ignorés et journalisés.

## 4. Configurer les recherches (`config.yaml`)

Le plus simple : règle tes filtres sur le site Vinted, trie par **Plus récents**, puis
colle l'URL dans `url:`. Tu peux ajouter à côté les filtres que Vinted ne propose pas :

```yaml
searches:
  - name: Nike Dunk 42
    url: "https://www.vinted.fr/catalog?search_text=nike%20dunk&size_ids[]=1196"
    price_max: 60
    include_keywords: [dunk]               # tous requis (titre + marque)
    include_any: [low, high]               # au moins un
    exclude_keywords: [enfant, "lot de"]   # aucun (mots entiers, accents ignorés)
    countries: [FR, BE]
    interval_seconds: 60
```

| Champ | Rôle |
|---|---|
| `url` | URL de recherche Vinted. Les identifiants de marque, catégorie, taille et état en sont extraits. |
| `search_text`, `brand_ids`, `catalog_ids`, `size_ids`, `color_ids` | Filtres envoyés à Vinted. Les identifiants numériques se lisent dans l'URL. |
| `status` | `neuf_avec_etiquette`, `neuf_sans_etiquette`, `tres_bon_etat`, `bon_etat`, `satisfaisant` (ou identifiants numériques). |
| `price_min` / `price_max` | Fourchette de prix. |
| `include_keywords` / `include_any` / `exclude_keywords` | Filtrage local sur le titre et la marque. |
| `countries` | Pays du vendeur. Appliqué seulement quand Vinted fournit l'information. |
| `max_age_minutes` | Ignore les vieilles annonces simplement « remontées ». |
| `interval_seconds` | Fréquence de la recherche (minimum 30 s). |
| `auto_buy`, `auto_buy_max_price` | Voir section 6. |

Vérifie ta configuration sans rien enregistrer ni notifier :

```bash
python -m vwatch check
```

La commande affiche les 10 premières annonces de chaque recherche : ✔ pour celles
retenues, ✗ avec la raison pour les autres.

## 5. Lancer la surveillance

```bash
python -m vwatch run
```

- **Premier passage** : les annonces déjà en ligne sont mémorisées sans notification.
  Seules les suivantes déclenchent une alerte.
- **Historique** : `data/vwatch.db` (SQLite). Les annonces non retenues sont purgées après 60 jours.
- **Logs** : console + `logs/vwatch.log` (rotation 5 × 5 Mo). Passe `logging.level`
  à `DEBUG` pour voir chaque rejet et sa raison.

### Sur Telegram

Chaque annonce arrive avec sa photo et un lien qui ouvre l'appli Vinted sur le téléphone.

- **🛒 Acheter** affiche une confirmation (`✅ SIMULER 32 €` / `✖️ Annuler`). Rien ne
  s'achète en un seul clic.
- **🙈 Ignorer** retire les boutons.
- Commandes : `/status`, `/pause [minutes]`, `/resume`, `/budget`, `/achats`, `/help`.

### Protections anti-blocage

| Situation | Réaction |
|---|---|
| HTTP 429, 403, captcha, page de vérification | Pause de 30 min et alerte Telegram, puis 60 min à la récidive. Au 3ᵉ blocage consécutif, arrêt jusqu'à `/resume`. |
| HTTP 401 (session expirée) | Un rechargement de la page d'accueil, comme le ferait le navigateur. Si ça ne suffit pas : pause et alerte « réexporte tes cookies ». |
| Erreurs réseau | Délai qui s'allonge progressivement (15 min max), alerte au bout de 10 erreurs. |

Jamais de résolution de captcha, de rotation de proxies ni de changement d'empreinte.

## 6. Achat (simulation, puis réel)

Garde-fous **vérifiés avant chaque achat**, qu'il soit automatique ou manuel :

| Garde-fou | Paramètre |
|---|---|
| Prix max par article (protection acheteur comprise, hors port) | `purchase.max_price_per_item` et `auto_buy_max_price` par recherche |
| Budget par jour calendaire | `purchase.daily_budget` |
| Budget sur 7 jours glissants | `purchase.weekly_budget` |
| 1 auto-achat maximum par recherche et par jour | plafonné à 1 dans le code |
| Vendeurs exclus | `purchase.seller_blacklist` (pseudo ou identifiant) |
| Jamais deux fois le même article | automatique |
| Un seul achat traité à la fois | verrou interne |
| Notification après chaque achat ou refus | automatique |

**Activer l'auto-achat en simulation** (aucun paiement) :

```yaml
purchase:
  mode: simulation
  auto_buy_enabled: true      # interrupteur général
searches:
  - name: ...
    auto_buy: true            # cette recherche seulement
    auto_buy_max_price: 35
```

Tu reçois alors « 🧪 SIMULATION — J'aurais acheté X à Y € » avec l'état du budget.
Les achats simulés comptent dans un budget simulé séparé, ce qui permet de tester les
plafonds dans des conditions réalistes. Laisse tourner quelques jours et vérifie avec
`/achats` que le bot aurait acheté exactement ce que tu voulais.

**Achat réel (étape 5).** Il ne fonctionne pas encore, volontairement. Même avec
`mode: real` et `i_understand_real_money: true`, le bot répond « flux d'achat réel non
implémenté » et ne paie rien. Pour avancer :

1. fais la capture `achat.har` ([docs/CAPTURE_HAR.md](docs/CAPTURE_HAR.md), partie B) ;
2. lance `python -m vwatch har achat.har` ;
3. envoie-moi le fichier `achat.resume.md`.

J'écrirai alors `vwatch/purchase_flow.py`. Avant de payer, le flux relira le **montant
final avec livraison** et annulera s'il dépasse ton plafond. Si ta banque exige une
validation 3-D Secure, le bot te préviendra pour que tu finisses l'achat dans l'appli :
il ne la contournera pas.

## 7. Faire tourner 24h/24

### Option A — Ton PC Windows

1. Désactive la mise en veille (*Paramètres > Système > Alimentation*).
2. *Planificateur de tâches > Créer une tâche* :
   - déclencheur **À l'ouverture de session** ;
   - action `deploy\start_windows.bat` ;
   - coche « Exécuter même si l'utilisateur n'est pas connecté ».
   Le script relance le bot automatiquement s'il s'arrête.

C'est l'option la plus fiable côté Vinted, car les requêtes partent de la même adresse IP
que ton navigateur.

### Option B — Raspberry Pi ou petit serveur (≈ 4 €/mois)

Un Raspberry Pi chez toi garde l'IP de ta box : c'est l'idéal. Sinon, un petit VPS suffit
largement (Hetzner CX22 ≈ 4 €/mois, OVH VPS Starter, Oracle Cloud Free Tier).
Attention : une IP de datacenter est plus souvent soumise à vérification par Vinted.
Si les blocages se multiplient, préfère le Pi ou ton PC.

```bash
# Sur le serveur (Debian/Ubuntu/Raspberry Pi OS)
sudo apt install -y python3-venv git
git clone <ton dépôt> && cd <dépôt>/vinted_watcher
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# Copie .env et config.yaml depuis ton PC (scp), jamais via git
chmod 600 .env
.venv/bin/python -m vwatch check

# Service systemd
sed "s/UTILISATEUR/$USER/g" deploy/vinted-watcher.service | sudo tee /etc/systemd/system/vinted-watcher.service
# (adapte WorkingDirectory si le dossier n'est pas ~/vinted_watcher)
sudo systemctl daemon-reload
sudo systemctl enable --now vinted-watcher
journalctl -u vinted-watcher -f        # suivre les logs
```

Le service redémarre tout seul en cas de plantage ou de reboot. `/status` sur Telegram
confirme à tout moment qu'il tourne.

## 8. Tests

```bash
pip install pytest
python -m pytest -q
```

Les tests couvrent l'analyse des URL Vinted, les filtres, la détection des blocages,
tous les garde-fous d'achat (budgets, 1 auto-achat par jour, liste noire), le refus
garanti en mode réel et le caviardage des fichiers HAR.

## Structure

```
vwatch/
  config.py         lecture et validation de config.yaml + .env
  client.py         requêtes Vinted avec ta session, détection 401/403/429/captcha
  models.py         annonce normalisée
  filters.py        mots-clés inclus/exclus, prix, pays, ancienneté
  storage.py        SQLite : annonces vues, achats, état (pause…)
  telegram_bot.py   envoi photo + boutons, écoute des commandes
  buyer.py          garde-fous + simulation + orchestration de l'achat
  purchase_flow.py  achat réel (étape 5, à écrire depuis ton HAR)
  har_tool.py       résumé caviardé d'un fichier HAR
  app.py            boucle principale
```
