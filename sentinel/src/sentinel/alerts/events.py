"""Calendrier des événements à risque (FOMC, CPI, résultats…), tenu à la main en YAML.

Pas de source gratuite et fiable en temps réel pour le calendrier macro : plutôt qu'une
source douteuse, un fichier explicite que tu mets à jour. Le rapport dit clairement quand
il est vide.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import yaml

from sentinel.core.logging import get_logger

log = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class RiskEvent:
    when: datetime
    name: str
    impact: str = ""


def load_events(path: Path) -> list[RiskEvent]:
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out = []
    for e in raw.get("events", []) or []:
        try:
            when = datetime.fromisoformat(str(e["when"]))
            if when.tzinfo is None:
                when = when.replace(tzinfo=UTC)
            out.append(RiskEvent(when.astimezone(UTC), str(e["name"]), str(e.get("impact", ""))))
        except (KeyError, ValueError) as err:
            log.warning("event_invalid", entry=str(e), error=repr(err))
    return sorted(out, key=lambda x: x.when)


def upcoming(events: list[RiskEvent], now: datetime, days: int) -> list[RiskEvent]:
    end = now + timedelta(days=days)
    return [e for e in events if now <= e.when <= end]
