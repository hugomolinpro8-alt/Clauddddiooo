# Sentinel — analyse de marché et alertes Telegram

Outil personnel d'**aide à la décision**. Il surveille BTC, ETH et SOL en temps réel, détecte des
setups et t'envoie une alerte Telegram. **Il ne passe jamais d'ordre** : c'est toi qui décides
et qui exécutes.

> État : **Phase 2 terminée.** Moteur de backtest opérationnel. La première stratégie testée
> (pullback 4h) **n'a pas passé** les critères d'activation : elle reste désactivée.
> Voir [`reports/phase2_pullback.md`](reports/phase2_pullback.md) et le
> [journal des essais](reports/RESEARCH_LOG.md).

## Installation

Prérequis : Python ≥ 3.12 et [uv](https://docs.astral.sh/uv/).

```bash
cd sentinel
uv sync                      # crée .venv et installe les dépendances
cp .env.example .env         # puis remplir TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID
```

Créer le bot Telegram :
1. Sur Telegram, écrire à **@BotFather**, envoyer `/newbot` et récupérer le token.
2. Envoyer un message quelconque à ton bot.
3. Ouvrir `https://api.telegram.org/bot<TOKEN>/getUpdates` et lire `chat.id`.

## Lancement

```bash
uv run python -m sentinel --dry-run                 # messages affichés dans la console
uv run python -m sentinel                           # envoi réel sur Telegram
uv run python -m sentinel --probe --duration 300    # alerte de test à chaque clôture (latence)
uv run python scripts/live_probe.py --seconds 60    # mesure de latence réelle, Telegram compris
```

Si `api.binance.com` est géobloqué (HTTP 451, typique des serveurs cloud américains), ajoute
`--config config/config.yaml --config config/dev-mirror.yaml`. Les miroirs publics Binance ne
couvrent que le spot.

## Recherche et backtest

```bash
uv run python scripts/download_archives.py    # ~15 s : archives Binance 2019 → aujourd'hui
uv run python scripts/backtest_pullback.py    # ~90 s : rapport Markdown + graphique dans reports/
```

Le backtest rejoue l'historique dans les **mêmes** moteurs d'indicateurs et stratégies que le
live. Hypothèses d'exécution défavorables : entrée à l'ouverture suivante, stop supposé touché
avant l'objectif, gaps exécutés à l'ouverture, frais et slippage réels, funding des perps.
La mécanique est vérifiée par des scénarios calculés à la main (`tests/test_backtest_engine.py`).

## Tests

```bash
uv run pytest -q             # 62 tests, ~20 s, sans réseau
uv run pytest -q -s tests/test_latency.py   # affiche les percentiles de latence
uv run ruff check src tests && uv run mypy  # style + typage strict
```

## Comment ça marche

```
WebSocket Binance ─► parse ─► IndicatorEngine (O(1)/bougie) ─► détecteurs ─► Telegram
   (spot + perp)              │                                           │
                              └─ trou détecté → recharge REST → rejeu      └─► file « post » :
Watchdog : flux muet > 60 s → « ⚠️ FLUX COUPÉ », puis « ✅ FLUX RÉTABLI »         journal, rapport,
                                                                                    graphique (phases 3-4)
```

**Pourquoi WebSocket et pas du polling ?** Binance pousse chaque mise à jour dès qu'elle existe.
Le polling ajoute en moyenne un demi-intervalle de retard et consomme le quota d'API.

**Pourquoi des indicateurs incrémentaux ?** Une EMA se met à jour en une multiplication, alors que
la recalculer sur 500 bougies à chaque tick coûte 500 opérations. Chaque indicateur est testé
contre une référence pandas, avec une tolérance relative de 1e-9.

**Pourquoi des tâches séparées pour l'envoi ?** Si Telegram met 250 ms à répondre, les bougies
suivantes doivent continuer d'être traitées. Le test `test_slow_telegram_does_not_block_processing`
le vérifie.

**Look-ahead.** Un pivot (plus haut ou plus bas local) n'est connu que `k` bougies après coup.
Il porte donc sa date de confirmation. Le test `test_no_lookahead_truncation_invariance` vérifie
que les valeurs au temps t ne changent pas quand on ajoute des bougies futures.

**Secrets.** Le token Telegram figure dans l'URL de l'API. Les logs le masquent (`***REDACTED***`),
et les tests vérifient qu'il n'apparaît nulle part.

## Arborescence

```
src/sentinel/
  core/        modèles typés, config (YAML + .env), logs JSON avec masquage
  data/        flux WebSocket Binance, historique REST + cache Parquet, watchdog
  indicators/  SMA, EMA, RSI, MACD, ATR, Bollinger, VWAP, volume relatif, plus haut/bas,
               pivots, structure HH/HL, supports/résistances, moteur
  pipeline/    chemin critique + mesure de latence
  alerts/      client Telegram persistant, notifier console
scripts/live_probe.py   mesure de latence en conditions réelles
config/config.yaml      watchlist, unités de temps, paramètres (aucun secret)
```
