"""Modèle de coûts. Toutes les valeurs sont des fractions (0.001 = 0,10 %).

Valeurs par défaut = palier VIP0 Binance sans réduction BNB, volontairement prudentes :
  spot : taker 0,10 %, maker 0,10 %
  perp : taker 0,05 %, maker 0,02 % + funding réel historique
Slippage (inclut le demi-spread) : 0,05 % par exécution « au marché », doublé sur les stops
(un stop se déclenche quand le marché bouge vite contre toi : c'est là que l'exécution
est la pire). Les prises de profit sont des ordres limites : frais maker, pas de slippage.
"""

from __future__ import annotations

from dataclasses import dataclass

from sentinel.core.models import Market


@dataclass(frozen=True, slots=True)
class CostModel:
    taker_fee: float
    maker_fee: float
    slippage: float
    stop_slippage_mult: float = 2.0
    funding: bool = False

    @property
    def stop_slippage(self) -> float:
        return self.slippage * self.stop_slippage_mult

    @staticmethod
    def for_market(market: Market, slippage: float = 0.0005) -> CostModel:
        if market is Market.SPOT:
            return CostModel(taker_fee=0.001, maker_fee=0.001, slippage=slippage)
        return CostModel(taker_fee=0.0005, maker_fee=0.0002, slippage=slippage, funding=True)

    def scaled(self, k: float) -> CostModel:
        """Coûts multipliés par k (test de stress : et si l'exécution réelle est pire ?)."""
        return CostModel(
            self.taker_fee * k,
            self.maker_fee * k,
            self.slippage * k,
            self.stop_slippage_mult,
            self.funding,
        )

    @staticmethod
    def zero() -> CostModel:
        return CostModel(0.0, 0.0, 0.0)
