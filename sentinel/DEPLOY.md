# Déploiement 24/7

La stratégie active signale à la **clôture journalière, 00:00 UTC** (1h ou 2h du matin à Paris).
Si la machine dort à ce moment-là, l'alerte est perdue. D'où un serveur toujours allumé.

## Option recommandée : VPS (≈ 4-6 €/mois)

Un VPS de 2 vCPU / 2-4 Go suffit largement (le bot utilise ~150 Mo de RAM). Exemples :
Hetzner CX22, OVH VPS Starter. Choisir un datacenter en Europe (proche des serveurs Binance
de Tokyo/Francfort, et Binance n'y est pas géobloqué — contrairement aux États-Unis).

### 1. Installer Docker (Ubuntu/Debian)

```bash
ssh root@IP_DU_VPS
apt update && apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
adduser sentinel && usermod -aG docker sentinel   # ne pas faire tourner en root
su - sentinel
```

### 2. Récupérer le projet et configurer les secrets

```bash
git clone <URL_DE_TON_DÉPÔT> && cd <dépôt>/sentinel
cp .env.example .env && nano .env      # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
chmod 600 .env                         # lisible par toi seul
```

### 3. Lancer

```bash
docker compose up -d --build
docker compose ps                      # STATUS doit passer à "healthy" en ~1-4 min
docker compose logs -f                 # logs JSON (secrets masqués)
```

Tu dois recevoir sur Telegram « 🟢 Sentinel démarré … ». Envoie `/status` pour vérifier.

### 4. Ce qui est automatique

| Situation | Comportement |
|---|---|
| Crash du processus | Docker le relance (`restart: unless-stopped`) |
| Reboot du VPS | Docker redémarre au boot et relance le conteneur |
| Flux Binance coupé | Reconnexion auto ; « ⚠️ FLUX COUPÉ » après 60 s ; arrêt volontaire puis relance après 15 min |
| Boucle bloquée | Healthcheck « unhealthy » visible dans `docker compose ps` (pouls > 90 s) |
| Arrêt / mise à jour | SIGTERM géré : le journal est vidé avant de quitter |
| Bot mort sans prévenir | Le message « 💓 Sentinel en vie » quotidien (08:00 UTC) n'arrive pas |

### 5. Mettre à jour

```bash
git pull && docker compose up -d --build
```

Les positions papier ouvertes sont rechargées depuis `data/journal.sqlite` et rejouées sur les
bougies manquées pendant la mise à jour.

### 6. Sauvegarder le journal

```bash
# chaque nuit à 03:30, copie cohérente du journal SQLite (même pendant que le bot tourne)
crontab -e
30 3 * * * cd ~/<dépôt>/sentinel && docker compose exec -T sentinel /app/.venv/bin/python -c "import sqlite3; s=sqlite3.connect('data/journal.sqlite'); d=sqlite3.connect('data/journal.backup.sqlite'); s.backup(d)"
```

Copie ensuite `data/journal.backup.sqlite` hors du VPS de temps en temps (scp).

## Option : ton PC (Windows/macOS/Linux)

Docker Desktop + `docker compose up -d --build` fonctionne aussi. Limite : en veille, pas
d'alerte. Sur Windows, désactive la mise en veille (Paramètres → Alimentation) si tu veux
vraiment l'utiliser 24/7.

## Option : Raspberry Pi 4/5

L'image `python:3.12-slim` existe en ARM64 : même procédure. Utilise un SSD (pas une carte
SD : SQLite l'userait vite) et une alimentation officielle.

## Sécurité

- `.env` n'est jamais copié dans l'image (`.dockerignore`) ni dans les logs.
- Le bot n'accepte les commandes que de ton `TELEGRAM_CHAT_ID`.
- Le bot n'a besoin d'**aucune clé d'exchange** : il ne lit que des données publiques et ne
  passe jamais d'ordre.
- Sur le VPS, aucun port entrant n'est nécessaire : ferme tout sauf SSH (`ufw allow OpenSSH &&
  ufw enable`).
