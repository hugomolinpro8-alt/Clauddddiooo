"""Notifier de remplacement : affiche les messages au lieu de les envoyer (mode --dry-run)."""

from __future__ import annotations

import asyncio
import itertools
import time
from pathlib import Path

from sentinel.alerts.telegram import SentMessage


class ConsoleNotifier:
    def __init__(self, photo_dir: Path | None = None) -> None:
        self._ids = itertools.count(1)
        self.photo_dir = photo_dir or Path("data/charts")

    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage:
        t0 = time.perf_counter_ns()
        prefix = f"↳ (réponse à #{reply_to}) " if reply_to else ""
        print(f"\n📨 {prefix}{text}\n", flush=True)
        t1 = time.perf_counter_ns()
        return SentMessage(next(self._ids), t1, (t1 - t0) / 1e6)

    async def send_photo(
        self, png: bytes, caption: str = "", reply_to: int | None = None
    ) -> SentMessage:
        t0 = time.perf_counter_ns()
        mid = next(self._ids)
        path = self.photo_dir / f"console_{mid}.png"

        def _save() -> None:
            self.photo_dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(png)

        await asyncio.to_thread(_save)
        print(f"\n🖼️  (réponse à #{reply_to}) {caption} → {path}\n", flush=True)
        t1 = time.perf_counter_ns()
        return SentMessage(mid, t1, (t1 - t0) / 1e6)
