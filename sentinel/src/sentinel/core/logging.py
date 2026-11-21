"""Logs structurés (JSON) avec masquage systématique des secrets.

Piège classique : httpx journalise en INFO l'URL de chaque requête. Or l'URL de l'API
Telegram contient le token (`/bot<TOKEN>/sendMessage`). Sans précaution, le token finit
dans les logs. Deux protections :
  1. le logger `httpx`/`httpcore` est remonté à WARNING ;
  2. un filtre masque tout motif ressemblant à un token Telegram ou à une valeur
     enregistrée via `register_secret`, dans structlog ET dans le logging standard.
"""

from __future__ import annotations

import logging
import re
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

_TELEGRAM_TOKEN_RE = re.compile(r"(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}")
_SENSITIVE_KEYS = ("token", "secret", "password", "api_key", "apikey", "authorization")
_registered: set[str] = set()
MASK = "***REDACTED***"


def register_secret(value: str | None) -> None:
    """Ajoute une valeur exacte à masquer partout (ex. le token chargé depuis .env)."""
    if value and len(value) >= 6:
        _registered.add(value)


def redact_text(text: str) -> str:
    for s in _registered:
        if s in text:
            text = text.replace(s, MASK)
    return _TELEGRAM_TOKEN_RE.sub(MASK, text)


def _redact_value(key: str, value: Any) -> Any:
    if any(s in key.lower() for s in _SENSITIVE_KEYS):
        return MASK
    if isinstance(value, str):
        return redact_text(value)
    return value


def _redact_processor(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    for k in list(event_dict.keys()):
        event_dict[k] = _redact_value(k, event_dict[k])
    return event_dict


class _RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact_text(record.getMessage())
        record.args = None
        return True


def configure_logging(level: str = "INFO", json: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(_RedactingFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for noisy in ("httpx", "httpcore", "websockets", "hpack"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    renderer: Any = structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact_processor,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> Any:
    return structlog.get_logger(name)
