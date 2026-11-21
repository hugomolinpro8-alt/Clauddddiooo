"""Boucle principale : surveillance, filtres, notifications, achats."""

from __future__ import annotations

import logging
import os
import queue
import random
import signal
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import dotenv_values

from . import filters
from .buyer import Buyer
from .client import BlockedError, SessionExpiredError, VintedClient, VintedError
from .config import AppConfig, SearchConfig
from .models import Item
from .purchase_flow import RealPurchaseFlow
from .storage import Storage
from .telegram_bot import TelegramNotifier, esc

log = logging.getLogger(__name__)

HELP = (
    "<b>Commandes</b>\n"
    "/status – état de la surveillance\n"
    "/pause [minutes] – mettre en pause (sans durée : jusqu'à /resume)\n"
    "/resume – reprendre (recharge aussi les cookies du .env)\n"
    "/budget – dépenses du jour et des 7 derniers jours\n"
    "/achats – 10 derniers achats (simulés ou réels)\n"
    "/help – cette aide"
)


class App:
    def __init__(self, cfg: AppConfig, env_path: Path | None = None):
        self.cfg = cfg
        self.env_path = env_path
        self.storage = Storage(cfg.db_path, cfg.timezone)
        self.notifier = TelegramNotifier(cfg.telegram)
        self.client = self._make_client(cfg.cookies)
        self.buyer = Buyer(cfg.purchase, self.storage, self.notifier,
                           RealPurchaseFlow(self.client))
        self.searches = {s.name: s for s in cfg.searches if s.enabled}
        self.stop_event = threading.Event()
        self.purchase_queue: queue.Queue[tuple[int, str]] = queue.Queue()
        self.consecutive_blocks = 0
        self.consecutive_net_errors = 0
        self.started_at = datetime.now()
        self.stats = {"requests": 0, "new": 0, "matched": 0}

    def _make_client(self, cookies: str) -> VintedClient:
        return VintedClient(self.cfg.domain, cookies, self.cfg.user_agent,
                            self.cfg.cookies_state_path)

    # ================================================================ pause
    def pause(self, reason: str, minutes: float | None) -> None:
        until = "manual" if minutes is None else (
            datetime.now() + timedelta(minutes=minutes)).isoformat()
        self.storage.set("paused_until", until)
        self.storage.set("pause_reason", reason)
        log.warning("PAUSE (%s) : %s", "jusqu'à /resume" if minutes is None
                    else f"{minutes:.0f} min", reason)

    def resume(self) -> None:
        self.storage.set("paused_until", None)
        self.storage.set("pause_reason", None)
        log.info("Surveillance reprise.")

    def paused_info(self) -> tuple[bool, str]:
        until = self.storage.get("paused_until")
        if not until:
            return False, ""
        reason = self.storage.get("pause_reason", "")
        if until == "manual":
            return True, f"{reason} (jusqu'à /resume)"
        end = datetime.fromisoformat(until)
        if datetime.now() >= end:
            self.resume()
            self.notifier.send("▶️ Fin de la pause, la surveillance reprend.", silent=True)
            return False, ""
        return True, f"{reason} (reprise auto à {end:%H:%M})"

    def reload_cookies(self) -> bool:
        if not self.env_path or not self.env_path.exists():
            return False
        new = (dotenv_values(self.env_path).get("VINTED_COOKIES") or "").strip().strip("\"'")
        if new and new != self.cfg.cookies:
            self.cfg.cookies = new
            os.environ["VINTED_COOKIES"] = new
            self.client = self._make_client(new)
            self.buyer.flow = RealPurchaseFlow(self.client)
            log.info("Nouveaux cookies chargés depuis %s", self.env_path)
            return True
        return False

    # ================================================================ recherche
    def run_search(self, search: SearchConfig) -> None:
        params = search.api_params(self.cfg.per_page)
        if search.domain != self.client.domain:
            log.warning("[%s] domaine %s ≠ %s : la session utilisée est celle de %s",
                        search.name, search.domain, self.client.domain, self.client.domain)
        items = self.client.search(params)
        self.stats["requests"] += 1
        self.consecutive_blocks = 0
        self.consecutive_net_errors = 0

        seeded_key = f"seeded:{search.name}"
        if not self.storage.get(seeded_key):
            # Premier passage : on mémorise l'existant sans rien notifier.
            for it in items:
                self.storage.mark_seen(it, search.name, matched=False)
            self.storage.set(seeded_key, datetime.now().isoformat())
            log.info("[%s] initialisation : %d annonces existantes mémorisées "
                     "(pas de notification).", search.name, len(items))
            return

        new = [it for it in items if not self.storage.is_seen(it.id)]
        log.info("[%s] %d annonces reçues, %d nouvelles", search.name, len(items), len(new))
        # Plus ancienne d'abord pour garder l'ordre chronologique dans Telegram.
        for it in reversed(new):
            ok, why = filters.match(it, search)
            self.storage.mark_seen(it, search.name, matched=ok)
            self.stats["new"] += 1
            if not ok:
                log.debug("[%s] rejet %s « %s » : %s", search.name, it.id, it.title, why)
                continue
            self.stats["matched"] += 1
            log.info("[%s] ✔ MATCH %s « %s » %.2f %s (%s, %s)", search.name, it.id,
                     it.title, it.price, it.currency, it.size, it.status)
            self.notify_item(it, search)
            if search.auto_buy and self.cfg.purchase.auto_buy_enabled:
                self.buyer.buy(it, search, trigger="auto")

    def notify_item(self, item: Item, search: SearchConfig) -> None:
        extra = ""
        if search.auto_buy and self.cfg.purchase.auto_buy_enabled:
            extra = "🤖 Recherche en auto-achat" + (
                " (simulation)" if not self.cfg.purchase.is_real else " (RÉEL)")
        self.notifier.send_item(item, search.name, self.item_buttons(item), extra)

    @staticmethod
    def item_buttons(item: Item):
        return [[("🛒 Acheter", f"b:{item.id}"), ("🙈 Ignorer", f"i:{item.id}")]]

    # ================================================================ Telegram
    def on_command(self, cmd: str, args: list[str]) -> None:
        if cmd in ("start", "help", "aide"):
            self.notifier.send(HELP)
        elif cmd == "status":
            paused, why = self.paused_info()
            up = datetime.now() - self.started_at
            self.notifier.send(
                f"{'⏸ En pause : ' + esc(why) if paused else '▶️ Surveillance active'}\n"
                f"Mode achat : <b>{self.cfg.purchase.mode}</b> · auto-achat "
                f"{'ON' if self.cfg.purchase.auto_buy_enabled else 'OFF'}\n"
                f"Recherches : {esc(', '.join(self.searches))}\n"
                f"Depuis {str(up).split('.')[0]} : {self.stats['requests']} requêtes, "
                f"{self.stats['new']} nouvelles, {self.stats['matched']} retenues\n"
                f"Annonces en base : {self.storage.count_seen()}"
            )
        elif cmd == "pause":
            minutes = float(args[0]) if args and args[0].replace(".", "").isdigit() else None
            self.pause("pause demandée depuis Telegram", minutes)
            self.notifier.send("⏸ Pause " + (f"{minutes:.0f} min." if minutes else
                                             "jusqu'à /resume."))
        elif cmd in ("resume", "reprendre"):
            reloaded = self.reload_cookies()
            self.consecutive_blocks = 0
            self.resume()
            self.notifier.send("▶️ Reprise." + (" Nouveaux cookies chargés." if reloaded else ""))
        elif cmd == "budget":
            self.notifier.send(self.buyer.budget_summary())
        elif cmd == "achats":
            rows = self.storage.recent_purchases()
            if not rows:
                self.notifier.send("Aucun achat enregistré.")
                return
            lines = [f"{r['created_at'][:16].replace('T', ' ')} · {r['mode']}/{r['trigger']} · "
                     f"{r['status']} · {r['amount']:.2f} € · {esc(r['title'] or '')[:40]}"
                     for r in rows]
            self.notifier.send("<b>Derniers achats</b>\n" + "\n".join(lines))
        else:
            self.notifier.send("Commande inconnue. /help")

    def on_callback(self, cq: dict) -> None:
        data = cq.get("data") or ""
        msg = cq.get("message") or {}
        chat_id, msg_id = msg.get("chat", {}).get("id"), msg.get("message_id")
        action, _, raw_id = data.partition(":")
        if not raw_id.isdigit():
            self.notifier.answer_callback(cq["id"])
            return
        item_id = int(raw_id)
        loaded = self._load_item(item_id)
        if not loaded:
            self.notifier.answer_callback(cq["id"], "Annonce introuvable en base.")
            return
        item, _search = loaded

        if action == "b":  # étape de confirmation : jamais d'achat en un seul clic
            label = "SIMULER" if not self.cfg.purchase.is_real else "PAYER"
            self.notifier.edit_buttons(chat_id, msg_id, [[
                (f"✅ {label} {item.total_price:.2f} €", f"c:{item_id}"),
                ("✖️ Annuler", f"x:{item_id}"),
            ]])
            self.notifier.answer_callback(cq["id"], "Confirme l'achat")
        elif action == "c":
            self.notifier.edit_buttons(chat_id, msg_id, None)
            self.notifier.answer_callback(cq["id"], "Achat en cours…")
            self.purchase_queue.put((item_id, "manual"))
        elif action == "x":
            self.notifier.edit_buttons(chat_id, msg_id, self.item_buttons(item))
            self.notifier.answer_callback(cq["id"], "Annulé")
        elif action == "i":
            self.storage.mark_ignored(item_id)
            self.notifier.edit_buttons(chat_id, msg_id, None)
            self.notifier.answer_callback(cq["id"], "Ignorée")
        else:
            self.notifier.answer_callback(cq["id"])

    def _load_item(self, item_id: int) -> tuple[Item, SearchConfig | None] | None:
        found = self.storage.get_item_raw(item_id)
        if not found:
            return None
        search_name, raw = found
        search = self.searches.get(search_name)
        domain = search.domain if search else self.cfg.domain
        return Item.from_api(raw, domain), search

    def _process_purchase_queue(self) -> None:
        while True:
            try:
                item_id, trigger = self.purchase_queue.get_nowait()
            except queue.Empty:
                return
            loaded = self._load_item(item_id)
            if not loaded:
                continue
            item, search = loaded
            paused, why = self.paused_info()
            if paused and self.cfg.purchase.is_real:
                self.notifier.send(f"⛔ Achat réel impossible pendant la pause ({esc(why)}).")
                continue
            self.buyer.buy(item, search, trigger)

    # ================================================================ boucle
    def _handle_block(self, exc: BlockedError) -> None:
        self.consecutive_blocks += 1
        n, cfg = self.consecutive_blocks, self.cfg.polling
        if n >= cfg.max_consecutive_blocks:
            self.pause(f"Vinted bloque : {exc.reason}", None)
            self.notifier.send(
                f"🛑 <b>Vinted bloque les requêtes</b> ({esc(exc.reason)}), {n} fois de suite.\n"
                "Surveillance arrêtée jusqu'à /resume. Ouvre Vinted dans ton navigateur, "
                "fais la vérification si demandée, puis réexporte tes cookies si besoin.")
        else:
            minutes = cfg.block_pause_minutes * 2 ** (n - 1)
            self.pause(f"Vinted bloque : {exc.reason}", minutes)
            self.notifier.send(
                f"⚠️ <b>Blocage Vinted</b> : {esc(exc.reason)}\n"
                f"Pause automatique de {minutes} min (blocage {n}/{cfg.max_consecutive_blocks}). "
                "Aucun contournement n'est tenté.")

    def _tick_search(self, search: SearchConfig) -> float:
        """Exécute une recherche et renvoie le délai avant la prochaine."""
        base = search.interval_seconds + random.uniform(0, self.cfg.polling.jitter_seconds)
        try:
            self.run_search(search)
        except BlockedError as exc:
            log.error("Blocage Vinted : %s", exc.reason)
            self._handle_block(exc)
        except SessionExpiredError as exc:
            log.error("%s", exc)
            self.pause("session Vinted expirée", None)
            self.notifier.send(
                "🔑 <b>Session Vinted expirée</b>. Réexporte tes cookies dans le fichier .env "
                "(VINTED_COOKIES), puis envoie /resume.")
        except (requests.RequestException, VintedError) as exc:
            self.consecutive_net_errors += 1
            log.warning("[%s] erreur (%d de suite) : %s", search.name,
                        self.consecutive_net_errors, exc)
            if self.consecutive_net_errors == 10:
                self.notifier.send(f"📡 10 erreurs de suite ({esc(exc)}). Je continue d'essayer.")
            return min(base * 2 ** min(self.consecutive_net_errors, 4), 900)
        return base

    def run(self) -> None:
        signal.signal(signal.SIGTERM, lambda *_: self.stop_event.set())
        self.notifier.start_listening(
            self.on_command, self.on_callback,
            get_offset=lambda: int(self.storage.get("tg_offset", "0")),
            set_offset=lambda v: self.storage.set("tg_offset", str(v)),
        )
        p = self.cfg.purchase
        log.info("Démarrage : %d recherche(s), mode achat=%s, auto-achat=%s",
                 len(self.searches), p.mode, p.auto_buy_enabled)
        self.notifier.send(
            f"🚀 Vinted Watcher démarré · {len(self.searches)} recherche(s) · achat "
            f"<b>{p.mode}</b> · auto-achat {'ON' if p.auto_buy_enabled else 'OFF'}\n/help",
            silent=True)

        next_run = {name: 0.0 for name in self.searches}
        last_prune = 0.0
        try:
            while not self.stop_event.is_set():
                self._process_purchase_queue()
                paused, _ = self.paused_info()
                if not paused:
                    for name, search in self.searches.items():
                        if self.stop_event.is_set() or self.paused_info()[0]:
                            break
                        if time.monotonic() < next_run[name]:
                            continue
                        next_run[name] = time.monotonic() + self._tick_search(search)
                        self._process_purchase_queue()
                        self.stop_event.wait(self.cfg.polling.pause_between_searches)
                if time.monotonic() - last_prune > 86400:
                    pruned = self.storage.prune_seen()
                    if pruned:
                        log.info("Base nettoyée : %d anciennes annonces supprimées", pruned)
                    last_prune = time.monotonic()
                self.stop_event.wait(1)
        except KeyboardInterrupt:
            pass
        finally:
            log.info("Arrêt demandé.")
            self.notifier.send("⏹ Vinted Watcher arrêté.", silent=True)
            self.notifier.stop()
            self.client.save_cookies()
            self.storage.close()
