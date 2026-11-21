"""Étape 5 — flux d'achat RÉEL. Volontairement non implémenté pour l'instant.

Pourquoi ? Les endpoints d'achat de Vinted (création de transaction,
checkout, choix du point relais, confirmation du paiement) ne sont pas
publics et changent régulièrement. Les deviner pourrait aboutir à une
commande avec une mauvaise adresse ou un mauvais mode de livraison.

Ce module sera écrit à partir de TON fichier HAR d'achat, une fois
analysé avec `python -m vwatch har achat.har` (voir docs/CAPTURE_HAR.md).

Contrat attendu de `execute()` :
    1. ouvrir le checkout de l'annonce (création de la transaction) ;
    2. relire le MONTANT FINAL (article + protection + livraison) et lever
       PurchaseAborted s'il dépasse `max_total` — dernier garde-fou ;
    3. utiliser le moyen de paiement et l'adresse/point relais déjà
       enregistrés sur ton compte, sans rien saisir ;
    4. confirmer le paiement. Si la banque exige une validation 3-D Secure,
       on NE la contourne PAS : on lève PurchaseNeedsUserAction et tu finis
       l'achat dans l'appli Vinted.
"""

from __future__ import annotations

from dataclasses import dataclass

from .client import VintedClient
from .models import Item


class PurchaseAborted(Exception):
    """Achat annulé avant paiement (montant final trop élevé, article vendu…)."""


class PurchaseNeedsUserAction(Exception):
    """Une action humaine est requise (3-D Secure, vérification…)."""


@dataclass
class PurchaseResult:
    transaction_id: str
    amount_paid: float
    currency: str
    details: str = ""


class RealPurchaseFlow:
    IMPLEMENTED = False

    def __init__(self, client: VintedClient):
        self.client = client

    def execute(self, item: Item, max_total: float) -> PurchaseResult:
        raise NotImplementedError(
            "Achat réel pas encore implémenté (étape 5). Capture un HAR d'achat, "
            "analyse-le avec `python -m vwatch har`, puis envoie le résumé caviardé."
        )
