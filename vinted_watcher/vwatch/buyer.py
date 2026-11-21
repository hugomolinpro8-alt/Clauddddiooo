"""Achat (simulé ou réel) protégé par des garde-fous obligatoires."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import timedelta

from .config import PurchaseConfig, SearchConfig
from .models import Item
from .purchase_flow import (PurchaseAborted, PurchaseNeedsUserAction,
                            RealPurchaseFlow)
from .storage import Storage
from .telegram_bot import TelegramNotifier, esc

log = logging.getLogger(__name__)


@dataclass
class Decision:
    allowed: bool
    reason: str = ""


class GuardRails:
    """Toutes les vérifications passent AVANT le moindre appel d'achat."""

    def __init__(self, cfg: PurchaseConfig, storage: Storage):
        self.cfg = cfg
        self.storage = storage

    def check(self, item: Item, search: SearchConfig | None, trigger: str) -> Decision:
        cfg, mode = self.cfg, self.cfg.mode
        amount = item.total_price  # prudent : protection acheteur incluse

        if trigger == "auto":
            if not cfg.auto_buy_enabled:
                return Decision(False, "auto-achat désactivé globalement")
            if not search or not search.auto_buy:
                return Decision(False, "recherche non marquée auto_buy")

        seller_keys = {item.seller_login.lower(), str(item.seller_id or "")}
        if seller_keys & set(cfg.seller_blacklist):
            return Decision(False, f"vendeur en liste noire ({item.seller_login})")

        if cfg.max_price_per_item <= 0:
            return Decision(False, "purchase.max_price_per_item non configuré")
        if amount > cfg.max_price_per_item:
            return Decision(False, f"{amount:.2f} € > prix max global "
                                   f"{cfg.max_price_per_item:.2f} €")
        if trigger == "auto" and search and search.auto_buy_max_price is not None \
                and amount > search.auto_buy_max_price:
            return Decision(False, f"{amount:.2f} € > prix max de la recherche "
                                   f"{search.auto_buy_max_price:.2f} €")

        if self.storage.already_bought(item.id, mode):
            return Decision(False, "article déjà acheté")

        if trigger == "auto" and search:
            n = self.storage.auto_buys_today(search.name, mode)
            if n >= cfg.max_auto_buys_per_search_per_day:
                return Decision(False, f"déjà {n} auto-achat(s) aujourd'hui pour « {search.name} »")

        day = self.storage.spent_since(self.storage.start_of_day(), mode)
        if cfg.daily_budget <= 0 or day + amount > cfg.daily_budget:
            return Decision(False, f"budget jour dépassé ({day:.2f} + {amount:.2f} > "
                                   f"{cfg.daily_budget:.2f} €)")
        week = self.storage.spent_since(self.storage.now() - timedelta(days=7), mode)
        if cfg.weekly_budget <= 0 or week + amount > cfg.weekly_budget:
            return Decision(False, f"budget 7 jours dépassé ({week:.2f} + {amount:.2f} > "
                                   f"{cfg.weekly_budget:.2f} €)")
        return Decision(True)


class Buyer:
    def __init__(self, cfg: PurchaseConfig, storage: Storage, notifier: TelegramNotifier,
                 flow: RealPurchaseFlow | None = None):
        self.cfg = cfg
        self.storage = storage
        self.notifier = notifier
        self.guards = GuardRails(cfg, storage)
        self.flow = flow
        # Un seul achat à la fois : évite qu'un clic et un auto-achat
        # simultanés passent tous deux les vérifications de budget.
        self._lock = threading.Lock()

    def buy(self, item: Item, search: SearchConfig | None, trigger: str) -> Decision:
        search_name = search.name if search else "?"
        with self._lock:
            decision = self.guards.check(item, search, trigger)
            if not decision.allowed:
                log.info("Achat %s refusé pour %s (%s) : %s",
                         trigger, item.id, item.title, decision.reason)
                if trigger == "manual" or (search and search.auto_buy):
                    self.notifier.send(f"⛔ Achat refusé : <b>{esc(item.title)}</b>\n"
                                       f"Raison : {esc(decision.reason)}")
                return decision

            if not self.cfg.is_real:
                self.storage.record_purchase(item, search_name, "simulation", trigger,
                                             "simulated")
                log.info("[SIMULATION] J'aurais acheté %s (%s) à %.2f %s",
                         item.id, item.title, item.total_price, item.currency)
                self.notifier.send(
                    f"🧪 <b>SIMULATION</b> ({'auto' if trigger == 'auto' else 'manuel'})\n"
                    f"J'aurais acheté <b>{esc(item.title)}</b> à "
                    f"{item.total_price:.2f} {esc(item.currency)} (hors port)\n"
                    f'<a href="{esc(item.url)}">Voir l\'annonce</a>\n'
                    f"{self.budget_summary()}"
                )
                return decision

            return self._buy_real(item, search_name, trigger)

    def _buy_real(self, item: Item, search_name: str, trigger: str) -> Decision:
        if not self.flow or not self.flow.IMPLEMENTED:
            msg = "flux d'achat réel non implémenté (étape 5)"
            self.storage.record_purchase(item, search_name, "real", trigger, "failed", msg)
            self.notifier.send(f"⚠️ Achat réel impossible : {esc(msg)}")
            return Decision(False, msg)

        pid = self.storage.record_purchase(item, search_name, "real", trigger, "pending")
        try:
            res = self.flow.execute(item, max_total=self.cfg.max_price_per_item)
        except PurchaseNeedsUserAction as exc:
            self.storage.update_purchase(pid, "pending", f"action requise : {exc}")
            self.notifier.send(f"🔐 Achat de <b>{esc(item.title)}</b> en attente : {esc(exc)}\n"
                               f'<a href="{esc(item.url)}">Terminer dans Vinted</a>')
            return Decision(True, "action utilisateur requise")
        except PurchaseAborted as exc:
            self.storage.update_purchase(pid, "failed", str(exc))
            self.notifier.send(f"↩️ Achat annulé avant paiement : {esc(exc)}")
            return Decision(False, str(exc))
        except Exception as exc:  # noqa: BLE001 - on veut toujours prévenir
            log.exception("Échec de l'achat réel de %s", item.id)
            self.storage.update_purchase(pid, "failed", repr(exc))
            self.notifier.send(f"❌ Échec de l'achat de <b>{esc(item.title)}</b> : {esc(exc)}\n"
                               "Vérifie dans l'appli Vinted qu'aucune commande n'est en cours.")
            return Decision(False, str(exc))

        self.storage.update_purchase(pid, "done", f"transaction {res.transaction_id}")
        self.notifier.send(
            f"✅ <b>ACHAT EFFECTUÉ</b> ({trigger})\n<b>{esc(item.title)}</b>\n"
            f"Payé : {res.amount_paid:.2f} {esc(res.currency)}\n"
            f'<a href="{esc(item.url)}">Annonce</a>\n{self.budget_summary()}'
        )
        return Decision(True)

    def budget_summary(self) -> str:
        mode = self.cfg.mode
        day = self.storage.spent_since(self.storage.start_of_day(), mode)
        week = self.storage.spent_since(self.storage.now() - timedelta(days=7), mode)
        label = "simulé" if mode == "simulation" else "réel"
        return (f"💰 Budget {label} : jour {day:.2f}/{self.cfg.daily_budget:.2f} € · "
                f"7 j {week:.2f}/{self.cfg.weekly_budget:.2f} €")
