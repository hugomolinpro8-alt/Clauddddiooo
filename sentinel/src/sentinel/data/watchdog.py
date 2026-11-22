"""Chien de garde : un bot silencieux est un bot dangereux.

Chaque flux (ex. `spot:BTCUSDT`) est « touché » à chaque message. Si un flux reste muet
plus de `stale_after_s`, on émet UNE alerte FLUX COUPÉ (pas une par seconde), puis une
alerte de rétablissement quand les messages reviennent, avec la durée de l'interruption.

La logique est séparée en `check()` (synchrone, horloge injectable → testable sans
attendre 60 s) et `run()` (boucle asyncio qui appelle check périodiquement).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WatchdogEvent:
    name: str
    stale: bool  # True = coupure détectée, False = rétabli
    silent_for_s: float


class FeedWatchdog:
    def __init__(
        self,
        stale_after_s: float,
        on_event: Callable[[WatchdogEvent], Awaitable[None]],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.stale_after_s = stale_after_s
        self._on_event = on_event
        self._clock = clock
        self._last: dict[str, float] = {}
        self._stale_since: dict[str, float] = {}

    def register(self, name: str) -> None:
        """Surveille un flux dès maintenant, même s'il n'a encore rien envoyé."""
        self._last.setdefault(name, self._clock())

    def touch(self, name: str) -> None:
        self._last[name] = self._clock()

    def check(self) -> list[WatchdogEvent]:
        now = self._clock()
        events: list[WatchdogEvent] = []
        for name, last in self._last.items():
            silent = now - last
            if name in self._stale_since:
                if silent < self.stale_after_s:
                    down_for = last - self._stale_since.pop(name) + self.stale_after_s
                    events.append(WatchdogEvent(name, False, down_for))
            elif silent >= self.stale_after_s:
                self._stale_since[name] = last + self.stale_after_s
                events.append(WatchdogEvent(name, True, silent))
        return events

    def silence(self) -> dict[str, float]:
        """Secondes écoulées depuis le dernier message, par flux."""
        now = self._clock()
        return {name: now - last for name, last in self._last.items()}

    @property
    def stale(self) -> set[str]:
        return set(self._stale_since)

    async def run(self, interval_s: float = 1.0) -> None:
        while True:
            await asyncio.sleep(interval_s)
            for ev in self.check():
                await self._on_event(ev)
