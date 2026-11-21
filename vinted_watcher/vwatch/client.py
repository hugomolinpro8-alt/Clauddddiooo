"""Client HTTP Vinted minimal, qui utilise TA session de navigateur.

Principes :
- aucune connexion par mot de passe : uniquement les cookies exportés ;
- aucune tentative de contournement : sur 403/429/captcha, on lève
  BlockedError et l'application se met en pause en te prévenant.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import requests

from .models import Item

log = logging.getLogger(__name__)

CATALOG_PATH = "/api/v2/catalog/items"

_CHALLENGE_MARKERS = (
    "captcha-delivery.com",
    "datadome",
    "geo.captcha",
    "captcha",
    "cf-challenge",
    "challenge-platform",
    "verify you are human",
    "vérification",
)


class VintedError(Exception):
    pass


class BlockedError(VintedError):
    """Vinted refuse ou demande une vérification : on s'arrête."""

    def __init__(self, reason: str, status: int | None = None):
        super().__init__(reason)
        self.reason = reason
        self.status = status


class SessionExpiredError(VintedError):
    """Les cookies ne sont plus valides : il faut les réexporter."""


def parse_cookie_header(header: str) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for part in header.split(";"):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        if name:
            cookies[name] = value.strip()
    return cookies


def detect_block(resp: requests.Response) -> BlockedError | None:
    """Renvoie une BlockedError si la réponse ressemble à un blocage."""
    status = resp.status_code
    ctype = resp.headers.get("Content-Type", "")
    body = ""
    try:
        body = resp.text[:4000].lower()
    except Exception:  # pragma: no cover - corps illisible
        pass
    has_challenge = any(m in body for m in _CHALLENGE_MARKERS) or (
        "x-datadome" in {k.lower() for k in resp.headers} and status >= 400
    )
    if status == 429:
        return BlockedError("trop de requêtes (HTTP 429)", status)
    if status == 403:
        if has_challenge:
            return BlockedError("captcha / vérification anti-bot (HTTP 403)", status)
        return BlockedError("accès refusé (HTTP 403)", status)
    if has_challenge and "json" not in ctype:
        return BlockedError(f"page de vérification reçue (HTTP {status})", status)
    if status == 200 and "html" in ctype:
        return BlockedError("réponse HTML inattendue (probable vérification)", status)
    return None


class VintedClient:
    def __init__(
        self,
        domain: str,
        cookie_header: str,
        user_agent: str,
        cookies_state_path: Path | None = None,
        timeout: float = 15.0,
    ):
        if not cookie_header:
            raise VintedError(
                "VINTED_COOKIES est vide : renseigne-le dans .env (voir README)."
            )
        if not user_agent:
            raise VintedError(
                "VINTED_USER_AGENT est vide : copie le User-Agent de ton navigateur."
            )
        self.domain = domain
        self.base_url = f"https://{domain}"
        self.cookie_domain = "." + domain.removeprefix("www.")
        self.timeout = timeout
        self.cookies_state_path = cookies_state_path
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": user_agent,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            "Referer": f"{self.base_url}/catalog",
            "Origin": self.base_url,
        })
        self._load_cookies(cookie_header)

    # ---------------------------------------------------------- cookies
    def _load_cookies(self, cookie_header: str) -> None:
        for name, value in parse_cookie_header(cookie_header).items():
            self.session.cookies.set(name, value, domain=self.cookie_domain, path="/")
        # Les cookies rafraîchis par Vinted lors d'une exécution précédente
        # sont plus récents que ceux du .env : on les réapplique par-dessus.
        if self.cookies_state_path and self.cookies_state_path.exists():
            try:
                saved = json.loads(self.cookies_state_path.read_text("utf-8"))
                if saved.get("source_fingerprint") == _fingerprint(cookie_header):
                    for name, value in saved.get("cookies", {}).items():
                        self.session.cookies.set(
                            name, value, domain=self.cookie_domain, path="/"
                        )
                    log.debug("Cookies rafraîchis rechargés depuis %s", self.cookies_state_path)
            except (OSError, ValueError) as exc:
                log.warning("Impossible de relire %s : %s", self.cookies_state_path, exc)
        self._source_fp = _fingerprint(cookie_header)

    def save_cookies(self) -> None:
        if not self.cookies_state_path:
            return
        self.cookies_state_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "source_fingerprint": self._source_fp,
            "cookies": {c.name: c.value for c in self.session.cookies},
        }
        tmp = self.cookies_state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(self.cookies_state_path)
        try:
            self.cookies_state_path.chmod(0o600)
        except OSError:
            pass

    # ---------------------------------------------------------- HTTP
    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        url = path if path.startswith("http") else self.base_url + path
        resp = self.session.request(method, url, timeout=self.timeout, **kwargs)
        log.debug("%s %s -> %s", method, resp.url, resp.status_code)
        block = detect_block(resp)
        if block:
            raise block
        return resp

    def _refresh_session(self) -> bool:
        """Recharge la page d'accueil comme le ferait le navigateur.

        Vinted renouvelle alors le jeton d'accès à partir du refresh token
        présent dans tes cookies. Pas de mot de passe, pas de contournement.
        """
        before = self.session.cookies.get("access_token_web")
        # Requête HTML : on ne passe pas par _request (une page HTML est
        # normale ici), mais on reste attentif aux 403/429/captcha.
        resp = self.session.get(
            self.base_url + "/", timeout=self.timeout,
            headers={"Accept": "text/html,application/xhtml+xml"},
        )
        if resp.status_code != 200:
            raise detect_block(resp) or SessionExpiredError(
                f"Rafraîchissement de session impossible (HTTP {resp.status_code})."
            )
        if any(m in resp.text[:4000].lower() for m in ("captcha-delivery.com", "geo.captcha")):
            raise BlockedError("captcha lors du rafraîchissement de session", 200)
        after = self.session.cookies.get("access_token_web")
        refreshed = bool(after) and after != before
        if refreshed:
            log.info("Jeton de session Vinted renouvelé.")
            self.save_cookies()
        return refreshed

    def get_json(self, path: str, params: dict | None = None, _retry: bool = True) -> dict:
        resp = self._request("GET", path, params=params)
        if resp.status_code == 401:
            if _retry and self._refresh_session():
                return self.get_json(path, params, _retry=False)
            raise SessionExpiredError(
                "Session Vinted expirée (HTTP 401) : réexporte tes cookies."
            )
        if resp.status_code >= 400:
            raise VintedError(f"HTTP {resp.status_code} sur {path} : {resp.text[:200]}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise BlockedError("réponse non JSON (probable vérification)") from exc
        if "set-cookie" in {k.lower() for k in resp.headers}:
            self.save_cookies()
        return data

    # ---------------------------------------------------------- API
    def search(self, params: dict) -> list[Item]:
        data = self.get_json(CATALOG_PATH, params=params)
        items = data.get("items")
        if items is None:
            raise VintedError(f"Réponse catalogue inattendue : clés {list(data)[:10]}")
        out = []
        for raw in items:
            try:
                out.append(Item.from_api(raw, self.domain))
            except (KeyError, TypeError, ValueError) as exc:
                log.warning("Annonce illisible ignorée (%s) : %s", exc, str(raw)[:200])
        return out


def _fingerprint(cookie_header: str) -> str:
    import hashlib

    return hashlib.sha256(cookie_header.encode()).hexdigest()[:16]
