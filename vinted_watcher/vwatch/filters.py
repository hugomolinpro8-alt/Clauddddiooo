"""Filtrage local des annonces (en complément des filtres de l'API Vinted).

L'API filtre déjà marque/catégorie/taille/état/prix ; ici on ajoute ce
qu'elle ne sait pas faire : mots-clés obligatoires/exclus, pays, âge.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from .config import SearchConfig
from .models import Item


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


@lru_cache(maxsize=1024)
def _pattern(keyword: str) -> re.Pattern:
    # Correspondance sur des mots entiers : "lot" ne matche pas "pilote".
    kw = re.escape(normalize(keyword).strip()).replace(r"\ ", r"\s+")
    return re.compile(rf"(?<!\w){kw}(?!\w)")


def contains(text: str, keyword: str) -> bool:
    return bool(_pattern(keyword).search(text))


def match(item: Item, search: SearchConfig, now: datetime | None = None) -> tuple[bool, str]:
    """Renvoie (garde ?, raison du rejet)."""
    haystack = normalize(" ".join([item.title, item.brand, item.description]))

    for kw in search.exclude_keywords:
        if contains(haystack, kw):
            return False, f"mot exclu « {kw} »"
    for kw in search.include_keywords:
        if not contains(haystack, kw):
            return False, f"mot requis absent « {kw} »"
    if search.include_any and not any(contains(haystack, kw) for kw in search.include_any):
        return False, "aucun des mots « include_any »"

    if search.price_min is not None and item.price < search.price_min:
        return False, f"prix {item.price} < {search.price_min}"
    if search.price_max is not None and item.price > search.price_max:
        return False, f"prix {item.price} > {search.price_max}"

    # Pays : n'est filtré que si Vinted fournit l'information.
    if search.countries and item.country_code:
        if item.country_code.upper() not in search.countries:
            return False, f"pays {item.country_code}"

    if search.max_age_minutes and item.created_at:
        now = now or datetime.now(timezone.utc)
        if now - item.created_at > timedelta(minutes=int(search.max_age_minutes)):
            return False, "annonce trop ancienne (remontée)"

    return True, ""
