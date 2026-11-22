"""Client Telegram asynchrone à connexion persistante.

Pourquoi persistante : ouvrir une connexion HTTPS coûte un aller-retour TCP + un
handshake TLS (≈ 2-3 allers-retours réseau, 50-200 ms). En gardant la connexion
ouverte (keep-alive, HTTP/2) et en la « chauffant » au démarrage avec `getMe`,
chaque alerte ne paie plus qu'un seul aller-retour.

Le token fait partie de l'URL (`/bot<TOKEN>/…`) : on ne journalise JAMAIS l'URL, et
les erreurs httpx (qui contiennent l'URL) sont réécrites via `redact_text`.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import SecretStr

from sentinel.core.logging import get_logger, redact_text, register_secret

log = get_logger(__name__)


class TelegramError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class SentMessage:
    message_id: int
    sent_mono_ns: int
    roundtrip_ms: float


class TelegramClient:
    def __init__(
        self,
        token: SecretStr,
        chat_id: str,
        base_url: str = "https://api.telegram.org",
        timeout_s: float = 10.0,
        max_retries: int = 2,
        http2: bool = True,
    ) -> None:
        raw = token.get_secret_value()
        register_secret(raw)
        self._chat_id = chat_id
        self._max_retries = max_retries
        self._client = httpx.AsyncClient(
            base_url=f"{base_url.rstrip('/')}/bot{raw}",
            timeout=httpx.Timeout(timeout_s, connect=5.0),
            limits=httpx.Limits(max_keepalive_connections=4, keepalive_expiry=300),
            http2=http2,
        )

    async def __aenter__(self) -> TelegramClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def warmup(self) -> dict[str, Any]:
        """Ouvre la connexion (TLS) et vérifie le token. À appeler au démarrage."""
        result: dict[str, Any] = await self._call("getMe", {})
        return result

    async def _call(
        self,
        method: str,
        payload: dict[str, Any],
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> Any:
        attempt = 0
        while True:
            try:
                if files:
                    # multipart : les champs non-fichier doivent être des chaînes
                    data = {
                        k: v if isinstance(v, str) else json.dumps(v) for k, v in payload.items()
                    }
                    r = await self._client.post(f"/{method}", data=data, files=files)
                else:
                    r = await self._client.post(f"/{method}", json=payload)
            except httpx.HTTPError as e:
                if attempt >= self._max_retries:
                    raise TelegramError(redact_text(f"{method}: {e!r}")) from None
                attempt += 1
                await asyncio.sleep(0.2 * attempt)
                continue
            body = (
                r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            )
            if r.status_code == 429 and attempt < self._max_retries:
                # Limite de débit Telegram (~1 msg/s par chat) : on respecte retry_after.
                retry = float(body.get("parameters", {}).get("retry_after", 1))
                log.warning("telegram_rate_limited", retry_after_s=retry)
                attempt += 1
                await asyncio.sleep(retry)
                continue
            if r.status_code >= 500 and attempt < self._max_retries:
                attempt += 1
                await asyncio.sleep(0.2 * attempt)
                continue
            if not body.get("ok"):
                raise TelegramError(
                    redact_text(f"{method}: HTTP {r.status_code} {body.get('description', '')}")
                )
            return body["result"]

    async def send_message(
        self,
        text: str,
        reply_to: int | None = None,
        disable_preview: bool = True,
        parse_mode: str | None = None,
    ) -> SentMessage:
        payload: dict[str, Any] = {
            "chat_id": self._chat_id,
            "text": text,
            "link_preview_options": {"is_disabled": disable_preview},
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_to is not None:
            payload["reply_parameters"] = {
                "message_id": reply_to,
                "allow_sending_without_reply": True,
            }
        t0 = time.perf_counter_ns()
        result = await self._call("sendMessage", payload)
        t1 = time.perf_counter_ns()
        return SentMessage(int(result["message_id"]), t1, (t1 - t0) / 1e6)

    async def send_photo(
        self, png: bytes, caption: str = "", reply_to: int | None = None
    ) -> SentMessage:
        payload: dict[str, Any] = {"chat_id": self._chat_id, "caption": caption[:1024]}
        if reply_to is not None:
            payload["reply_parameters"] = {
                "message_id": reply_to,
                "allow_sending_without_reply": True,
            }
        t0 = time.perf_counter_ns()
        result = await self._call(
            "sendPhoto", payload, files={"photo": ("chart.png", png, "image/png")}
        )
        t1 = time.perf_counter_ns()
        return SentMessage(int(result["message_id"]), t1, (t1 - t0) / 1e6)

    async def get_updates(self, offset: int | None, timeout_s: int = 30) -> list[dict[str, Any]]:
        """Interrogation longue (« long polling ») des commandes reçues. Sur un PC sans IP
        publique, c'est la seule option (pas de webhook). Hors chemin critique."""
        payload: dict[str, Any] = {"timeout": timeout_s, "allowed_updates": ["message"]}
        if offset is not None:
            payload["offset"] = offset
        try:
            r = await self._client.post("/getUpdates", json=payload, timeout=timeout_s + 15)
            body = r.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("telegram_get_updates_failed", error=redact_text(repr(e)))
            await asyncio.sleep(5)
            return []
        if not body.get("ok"):
            log.warning("telegram_get_updates_error", description=body.get("description"))
            await asyncio.sleep(5)
            return []
        result: list[dict[str, Any]] = body["result"]
        return result
