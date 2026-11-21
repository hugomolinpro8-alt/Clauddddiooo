"""Notifier de remplacement : affiche les messages au lieu de les envoyer (mode --dry-run)."""

from __future__ import annotations

import itertools
import time

from sentinel.alerts.telegram import SentMessage


class ConsoleNotifier:
    def __init__(self) -> None:
        self._ids = itertools.count(1)

    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage:
        t0 = time.perf_counter_ns()
        prefix = f"↳ (réponse à #{reply_to}) " if reply_to else ""
        print(f"\n📨 {prefix}{text}\n", flush=True)
        t1 = time.perf_counter_ns()
        return SentMessage(next(self._ids), t1, (t1 - t0) / 1e6)
