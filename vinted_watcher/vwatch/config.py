"""Chargement et validation de la configuration (config.yaml + .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlparse

import yaml
from dotenv import load_dotenv

# Garde-fous "non négociables" sur la fréquence d'interrogation.
MIN_INTERVAL_SECONDS = 30
MIN_PAUSE_BETWEEN_SEARCHES = 2

# Identifiants d'état Vinted (paramètre status_ids). À vérifier dans l'URL
# de recherche de ton navigateur si Vinted les change un jour.
STATUS_ALIASES = {
    "neuf_avec_etiquette": 6,
    "neuf_sans_etiquette": 1,
    "tres_bon_etat": 2,
    "bon_etat": 3,
    "satisfaisant": 4,
}

# Paramètres de l'URL web Vinted -> paramètres de l'API catalogue.
_URL_LIST_PARAMS = {
    "catalog[]": "catalog_ids",
    "catalog_ids[]": "catalog_ids",
    "brand_ids[]": "brand_ids",
    "size_ids[]": "size_ids",
    "status_ids[]": "status_ids",
    "color_ids[]": "color_ids",
    "material_ids[]": "material_ids",
}
_URL_SCALAR_PARAMS = {"search_text", "price_from", "price_to", "currency"}


class ConfigError(ValueError):
    pass


@dataclass
class SearchConfig:
    name: str
    domain: str
    enabled: bool = True
    search_text: str = ""
    include_keywords: list[str] = field(default_factory=list)  # tous requis
    include_any: list[str] = field(default_factory=list)  # au moins un
    exclude_keywords: list[str] = field(default_factory=list)  # aucun
    catalog_ids: list[int] = field(default_factory=list)
    brand_ids: list[int] = field(default_factory=list)
    size_ids: list[int] = field(default_factory=list)
    status_ids: list[int] = field(default_factory=list)
    color_ids: list[int] = field(default_factory=list)
    material_ids: list[int] = field(default_factory=list)
    price_min: float | None = None
    price_max: float | None = None
    currency: str | None = None
    countries: list[str] = field(default_factory=list)  # codes ISO, ex. FR
    max_age_minutes: int | None = None
    interval_seconds: int = 60
    auto_buy: bool = False
    auto_buy_max_price: float | None = None

    def api_params(self, per_page: int) -> dict[str, str]:
        """Paramètres envoyés à /api/v2/catalog/items (tri : plus récent)."""
        params: dict[str, str] = {
            "page": "1",
            "per_page": str(per_page),
            "order": "newest_first",
        }
        if self.search_text:
            params["search_text"] = self.search_text
        for key in ("catalog_ids", "brand_ids", "size_ids", "status_ids",
                    "color_ids", "material_ids"):
            values = getattr(self, key)
            if values:
                params[key] = ",".join(str(v) for v in values)
        if self.price_min is not None:
            params["price_from"] = _fmt_price(self.price_min)
        if self.price_max is not None:
            params["price_to"] = _fmt_price(self.price_max)
        if self.currency:
            params["currency"] = self.currency
        return params


@dataclass
class PollingConfig:
    interval_seconds: int = 60
    jitter_seconds: int = 10
    pause_between_searches: float = 3.0
    block_pause_minutes: int = 30
    max_consecutive_blocks: int = 3


@dataclass
class TelegramConfig:
    enabled: bool = True
    token: str = ""
    chat_id: str = ""
    listen_commands: bool = True


@dataclass
class PurchaseConfig:
    mode: str = "simulation"  # "simulation" ou "real"
    i_understand_real_money: bool = False
    auto_buy_enabled: bool = False  # interrupteur général de l'auto-achat
    max_price_per_item: float = 0.0
    daily_budget: float = 0.0
    weekly_budget: float = 0.0
    max_auto_buys_per_search_per_day: int = 1
    seller_blacklist: list[str] = field(default_factory=list)

    @property
    def is_real(self) -> bool:
        return self.mode == "real"


@dataclass
class AppConfig:
    domain: str
    per_page: int
    timezone: str
    db_path: Path
    cookies_state_path: Path
    log_level: str
    log_file: Path | None
    cookies: str
    user_agent: str
    polling: PollingConfig
    telegram: TelegramConfig
    purchase: PurchaseConfig
    searches: list[SearchConfig]


def _fmt_price(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def parse_vinted_url(url: str) -> tuple[str, dict[str, Any]]:
    """Transforme une URL de recherche Vinted copiée du navigateur en filtres.

    Exemple : https://www.vinted.fr/catalog?search_text=nike&brand_ids[]=53
    """
    parsed = urlparse(url)
    if not parsed.netloc or "vinted" not in parsed.netloc:
        raise ConfigError(f"URL Vinted invalide : {url!r}")
    out: dict[str, Any] = {}
    for key, value in parse_qsl(parsed.query, keep_blank_values=False):
        if key in _URL_LIST_PARAMS:
            dest = _URL_LIST_PARAMS[key]
            out.setdefault(dest, []).extend(
                int(v) for v in value.split(",") if v.strip().isdigit()
            )
        elif key in _URL_SCALAR_PARAMS:
            if key == "price_from":
                out["price_min"] = float(value)
            elif key == "price_to":
                out["price_max"] = float(value)
            else:
                out[key] = value
    return parsed.netloc, out


def _as_list(value: Any, cast=str) -> list:
    if value is None:
        return []
    if isinstance(value, (str, int, float)):
        value = [value]
    return [cast(v) for v in value]


def _status_ids(raw: Any) -> list[int]:
    ids = []
    for v in _as_list(raw, str):
        v = v.strip()
        if v.isdigit():
            ids.append(int(v))
        elif v in STATUS_ALIASES:
            ids.append(STATUS_ALIASES[v])
        else:
            raise ConfigError(
                f"État inconnu {v!r}. Valeurs possibles : "
                f"{', '.join(STATUS_ALIASES)} (ou un identifiant numérique)."
            )
    return ids


def _build_search(raw: dict, default_domain: str, default_interval: int) -> SearchConfig:
    if not raw.get("name"):
        raise ConfigError("Chaque recherche doit avoir un 'name'.")
    name = str(raw["name"])
    domain = raw.get("domain", default_domain)
    from_url: dict[str, Any] = {}
    if raw.get("url"):
        domain, from_url = parse_vinted_url(raw["url"])

    def pick(key, default=None):
        # La valeur explicite du YAML l'emporte sur celle déduite de l'URL.
        return raw[key] if key in raw else from_url.get(key, default)

    interval = int(raw.get("interval_seconds", default_interval))
    if interval < MIN_INTERVAL_SECONDS:
        raise ConfigError(
            f"[{name}] interval_seconds={interval} est trop agressif "
            f"(minimum {MIN_INTERVAL_SECONDS}s)."
        )

    s = SearchConfig(
        name=name,
        domain=domain,
        enabled=bool(raw.get("enabled", True)),
        search_text=str(pick("search_text", "") or ""),
        include_keywords=_as_list(raw.get("include_keywords")),
        include_any=_as_list(raw.get("include_any")),
        exclude_keywords=_as_list(raw.get("exclude_keywords")),
        catalog_ids=_as_list(pick("catalog_ids"), int),
        brand_ids=_as_list(pick("brand_ids"), int),
        size_ids=_as_list(pick("size_ids"), int),
        status_ids=_status_ids(pick("status_ids", raw.get("status"))),
        color_ids=_as_list(pick("color_ids"), int),
        material_ids=_as_list(pick("material_ids"), int),
        price_min=_opt_float(pick("price_min")),
        price_max=_opt_float(pick("price_max")),
        currency=pick("currency"),
        countries=[c.upper() for c in _as_list(raw.get("countries"))],
        max_age_minutes=raw.get("max_age_minutes"),
        interval_seconds=interval,
        auto_buy=bool(raw.get("auto_buy", False)),
        auto_buy_max_price=_opt_float(raw.get("auto_buy_max_price")),
    )
    if s.price_min is not None and s.price_max is not None and s.price_min > s.price_max:
        raise ConfigError(f"[{name}] price_min > price_max.")
    if s.auto_buy and s.auto_buy_max_price is None:
        raise ConfigError(
            f"[{name}] auto_buy: true exige auto_buy_max_price (prix max par article)."
        )
    return s


def _opt_float(v: Any) -> float | None:
    return None if v is None or v == "" else float(v)


def load_config(config_path: str | Path, env_path: str | Path | None = None) -> AppConfig:
    config_path = Path(config_path)
    base_dir = config_path.resolve().parent
    load_dotenv(env_path or base_dir / ".env", override=False)

    if not config_path.exists():
        raise ConfigError(f"Fichier de config introuvable : {config_path}")
    with config_path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    vinted = raw.get("vinted", {}) or {}
    domain = vinted.get("domain", "www.vinted.fr")
    per_page = int(vinted.get("per_page", 20))
    if not 1 <= per_page <= 96:
        raise ConfigError("vinted.per_page doit être entre 1 et 96.")

    p = raw.get("polling", {}) or {}
    polling = PollingConfig(
        interval_seconds=int(p.get("interval_seconds", 60)),
        jitter_seconds=int(p.get("jitter_seconds", 10)),
        pause_between_searches=max(
            float(p.get("pause_between_searches", 3)), MIN_PAUSE_BETWEEN_SEARCHES
        ),
        block_pause_minutes=int(p.get("block_pause_minutes", 30)),
        max_consecutive_blocks=int(p.get("max_consecutive_blocks", 3)),
    )
    if polling.interval_seconds < MIN_INTERVAL_SECONDS:
        raise ConfigError(f"polling.interval_seconds minimum : {MIN_INTERVAL_SECONDS}s.")

    t = raw.get("telegram", {}) or {}
    telegram = TelegramConfig(
        enabled=bool(t.get("enabled", True)),
        token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        chat_id=os.getenv("TELEGRAM_CHAT_ID", "").strip(),
        listen_commands=bool(t.get("listen_commands", True)),
    )

    b = raw.get("purchase", {}) or {}
    purchase = PurchaseConfig(
        mode=str(b.get("mode", "simulation")).lower(),
        i_understand_real_money=bool(b.get("i_understand_real_money", False)),
        auto_buy_enabled=bool(b.get("auto_buy_enabled", False)),
        max_price_per_item=float(b.get("max_price_per_item", 0)),
        daily_budget=float(b.get("daily_budget", 0)),
        weekly_budget=float(b.get("weekly_budget", 0)),
        # Plafonné à 1 quoi qu'il arrive (exigence de sécurité).
        max_auto_buys_per_search_per_day=min(
            int(b.get("max_auto_buys_per_search_per_day", 1)), 1
        ),
        seller_blacklist=[str(s).lower() for s in _as_list(b.get("seller_blacklist"))],
    )
    if purchase.mode not in ("simulation", "real"):
        raise ConfigError("purchase.mode doit valoir 'simulation' ou 'real'.")
    if purchase.is_real and not purchase.i_understand_real_money:
        raise ConfigError(
            "purchase.mode: real exige aussi purchase.i_understand_real_money: true."
        )

    searches = [
        _build_search(s, domain, polling.interval_seconds)
        for s in (raw.get("searches") or [])
    ]
    names = [s.name for s in searches]
    if len(names) != len(set(names)):
        raise ConfigError("Les noms de recherche doivent être uniques.")
    if not any(s.enabled for s in searches):
        raise ConfigError("Aucune recherche activée dans 'searches'.")
    if purchase.auto_buy_enabled and any(s.auto_buy for s in searches):
        for field_name in ("max_price_per_item", "daily_budget", "weekly_budget"):
            if getattr(purchase, field_name) <= 0:
                raise ConfigError(
                    f"Auto-achat activé : purchase.{field_name} doit être > 0."
                )

    storage = raw.get("storage", {}) or {}
    logging_cfg = raw.get("logging", {}) or {}
    log_file = logging_cfg.get("file", "logs/vwatch.log")

    def rel(path: str) -> Path:
        pth = Path(path)
        return pth if pth.is_absolute() else base_dir / pth

    return AppConfig(
        domain=domain,
        per_page=per_page,
        timezone=raw.get("timezone", "Europe/Paris"),
        db_path=rel(storage.get("db_path", "data/vwatch.db")),
        cookies_state_path=rel(storage.get("cookies_state_path", "data/session_cookies.json")),
        log_level=str(logging_cfg.get("level", "INFO")).upper(),
        log_file=rel(log_file) if log_file else None,
        cookies=os.getenv("VINTED_COOKIES", "").strip().strip('"').strip("'"),
        user_agent=os.getenv("VINTED_USER_AGENT", "").strip(),
        polling=polling,
        telegram=telegram,
        purchase=purchase,
        searches=searches,
    )
