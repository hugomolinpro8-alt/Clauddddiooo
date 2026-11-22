"""Taille de position : on part du RISQUE, jamais du montant qu'on a envie d'investir.

    montant risqué = capital × risque %            (ex. 3 000 € × 0,5 % = 15 €)
    quantité       = montant risqué / |entrée − stop|
    notionnel      = quantité × entrée

Exemple : BTC à 60 000, stop à 55 200 (−8 %) → 15 € / 4 800 = 0,003125 BTC ≈ 187,50 €.
Si le stop est serré, le notionnel peut dépasser le capital : en spot c'est impossible
(pas d'emprunt), on plafonne et le risque effectif devient plus petit que prévu — c'est
affiché. En perp, le plafond est le levier max autorisé, et on affiche la distance à la
liquidation : elle doit rester bien plus loin que le stop.
"""

from __future__ import annotations

from dataclasses import dataclass

from sentinel.core.models import Market

# Marge de maintenance approximative Binance USDT-M pour petites positions (palier 1).
MAINT_MARGIN = 0.004


@dataclass(frozen=True, slots=True)
class SizePlan:
    capital: float
    risk_pct: float
    risk_amount: float  # montant réellement risqué (après plafonnement éventuel)
    qty: float
    notional: float
    capital_share: float  # notionnel / capital
    capped: bool
    leverage: float  # perp : levier nécessaire (≥ 1) ; spot : 1
    liq_distance_pct: float | None  # perp : distance approximative à la liquidation (marge isolée)
    stop_distance_pct: float


def position_size(
    capital: float,
    risk_pct: float,
    entry: float,
    stop: float,
    market: Market,
    max_leverage: float = 1.0,
) -> SizePlan:
    if entry <= 0 or stop <= 0 or entry == stop:
        raise ValueError("entrée et stop doivent être > 0 et différents")
    dist = abs(entry - stop)
    risk_amount = capital * risk_pct / 100.0
    qty = risk_amount / dist  # 0 si le plafond de risque ouvert est atteint
    cap_notional = capital * (max_leverage if market is Market.PERP else 1.0)
    capped = qty * entry > cap_notional
    if capped:
        qty = cap_notional / entry
        risk_amount = qty * dist
    notional = qty * entry
    leverage = max(1.0, notional / capital) if market is Market.PERP else 1.0
    liq = None
    if market is Market.PERP:
        # Marge isolée = notionnel / levier ; liquidation ≈ quand la perte atteint
        # (1/levier − marge de maintenance) du notionnel.
        liq = max(1.0 / leverage - MAINT_MARGIN, 0.0)
    return SizePlan(
        capital,
        risk_pct,
        risk_amount,
        qty,
        notional,
        notional / capital,
        capped,
        leverage,
        liq,
        dist / entry,
    )


def allowed_risk_pct(base_pct: float, max_open_pct: float, open_pct: float) -> float:
    """Risque autorisé pour un nouveau trade sous le plafond de risque ouvert total.
    BTC/ETH/SOL chutent ensemble : 3 positions à 0,5 % = 1,5 % exposés au même choc.
    Renvoie 0 si le plafond est atteint (le trade ne devrait pas être pris)."""
    return max(0.0, min(base_pct, max_open_pct - open_pct))
