"""Représentation normalisée d'une annonce Vinted."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _money(value: Any) -> tuple[float | None, str | None]:
    """Vinted renvoie le prix soit en chaîne, soit en {amount, currency_code}."""
    if value is None:
        return None, None
    if isinstance(value, dict):
        amount = value.get("amount")
        return (float(amount) if amount not in (None, "") else None,
                value.get("currency_code"))
    try:
        return float(value), None
    except (TypeError, ValueError):
        return None, None


@dataclass
class Item:
    id: int
    title: str
    price: float
    total_price: float  # prix + protection acheteur si fourni (hors livraison)
    currency: str
    url: str
    brand: str = ""
    size: str = ""
    status: str = ""
    description: str = ""
    photo_url: str | None = None
    seller_id: int | None = None
    seller_login: str = ""
    country_code: str | None = None
    created_at: datetime | None = None
    raw: dict = field(default_factory=dict, repr=False)

    @classmethod
    def from_api(cls, data: dict, domain: str) -> "Item":
        price, cur1 = _money(data.get("price"))
        total, cur2 = _money(data.get("total_item_price"))
        currency = cur1 or cur2 or data.get("currency") or "EUR"
        if price is None:
            price = total or 0.0
        if total is None:
            total = price

        photo = data.get("photo") or {}
        photo_url = photo.get("full_size_url") or photo.get("url")
        created_at = None
        ts = (photo.get("high_resolution") or {}).get("timestamp")
        if ts:
            try:
                created_at = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except (TypeError, ValueError, OSError):
                created_at = None

        user = data.get("user") or {}
        url = data.get("url") or f"https://{domain}/items/{data['id']}"
        if url.startswith("/"):
            url = f"https://{domain}{url}"

        return cls(
            id=int(data["id"]),
            title=str(data.get("title") or ""),
            price=price,
            total_price=total,
            currency=currency,
            url=url,
            brand=str(data.get("brand_title") or ""),
            size=str(data.get("size_title") or ""),
            status=str(data.get("status") or ""),
            description=str(data.get("description") or ""),
            photo_url=photo_url,
            seller_id=user.get("id"),
            seller_login=str(user.get("login") or ""),
            country_code=(user.get("country_code") or data.get("country_code") or None),
            created_at=created_at,
            raw=data,
        )
