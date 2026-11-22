"""Colle entre le pipeline, le paper trader, le journal et Telegram (hors chemin critique)."""

from __future__ import annotations

import asyncio
import time
from collections import Counter
from typing import Protocol

from sentinel.alerts.telegram import SentMessage
from sentinel.core.logging import get_logger
from sentinel.journal.db import JournalWriter
from sentinel.paper.tracker import PaperTracker
from sentinel.pipeline.runner import Signal
from sentinel.pipeline.strategy_detector import AlertContext

log = get_logger(__name__)


class TextNotifier(Protocol):
    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage: ...


def now_ms() -> int:
    return time.time_ns() // 1_000_000


class PaperService:
    def __init__(
        self, tracker: PaperTracker, writer: JournalWriter, notifier: TextNotifier
    ) -> None:
        self.tracker = tracker
        self.writer = writer
        self.notifier = notifier
        self.ops_counter: Counter[str] = Counter()
        self.started_ms = now_ms()

    # --- crochet appelé après chaque alerte (OnSent) -----------------------------------
    def on_sent(
        self, sig: Signal, sent: SentMessage | None, muted: bool, observation: bool
    ) -> None:
        ctx = sig.payload
        if not isinstance(ctx, AlertContext):
            return
        aid = self.tracker.next_alert_id()
        self.writer.put(
            "insert_alert",
            {
                "id": aid,
                "created_ms": sig.bar.close_time_ms,
                "strategy": ctx.strategy_name,
                "market": sig.key.market.value,
                "symbol": sig.key.symbol,
                "side": ctx.setup.side.name,
                "signal_close": ctx.setup.signal_close,
                "stop": ctx.setup.stop,
                "risk_pct": ctx.size.risk_pct,
                "telegram_msg_id": sent.message_id if sent else None,
                "latency_ms": None,
                "muted": int(muted),
                "observation": int(observation),
                "text": sig.text,
                # journalisés pour réévaluer plus tard, sur le paper trading, si le score et
                # le smart money prédisent réellement la qualité des trades
                "score": ctx.score.total if ctx.score else None,
                "regime": ctx.regime.describe() if ctx.regime else None,
                "smart_money": (
                    f"{ctx.smart_money.same_side}/{ctx.smart_money.opposite_side}/"
                    f"{ctx.smart_money.tracked}"
                    if ctx.smart_money
                    else None
                ),
            },
        )
        # Le paper trading mesure la STRATÉGIE : il suit aussi les alertes muettes (pause)
        # ou en mode observation, pour savoir ce que le système aurait fait.
        self.tracker.add_from_alert(ctx.setup, sig.bar, aid, sent.message_id if sent else None)
        self.flush_writes()

    # --- journal d'exploitation (OpsLog) -----------------------------------------------
    def ops(self, kind: str, detail: str) -> None:
        self.ops_counter[kind] += 1
        self.writer.put("log_ops", now_ms(), kind, detail)

    # --- vidage de la boîte d'envoi ----------------------------------------------------
    def flush_writes(self) -> None:
        """Transfère les écritures en attente vers le journal (les messages restent dans
        la boîte d'envoi jusqu'au prochain passage de `run`)."""
        ob = self.tracker.outbox
        writes, ob.writes = ob.writes, []
        for method, args in writes:
            self.writer.put(method, *args)

    def flush_now(self) -> list[tuple[str, int | None]]:
        self.flush_writes()
        ob = self.tracker.outbox
        messages, ob.messages = ob.messages, []
        return messages

    async def run(self, interval_s: float = 1.0) -> None:
        pending: list[tuple[str, int | None]] = []
        while True:
            pending += self.flush_now()
            while pending:
                text, reply_to = pending.pop(0)
                try:
                    await self.notifier.send_message(text, reply_to=reply_to)
                except Exception as e:
                    log.error("paper_message_failed", error=repr(e))
                    self.ops("send_failure", "paper message")
                    break
            await asyncio.sleep(interval_s)
