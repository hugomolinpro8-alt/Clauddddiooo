"""Travailleur hors chemin critique : après l'envoi de l'alerte n°1, produit et envoie le
rapport n°2 (en réponse) puis le graphique (en réponse aussi).

Il consomme `Pipeline.post_queue`. Une erreur ici (graphique, Telegram) est journalisée
mais ne peut ni retarder ni bloquer les alertes suivantes.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from sentinel.alerts.chart import render_chart
from sentinel.alerts.events import RiskEvent, upcoming
from sentinel.alerts.format import format_report
from sentinel.alerts.telegram import SentMessage
from sentinel.core.logging import get_logger
from sentinel.pipeline.runner import Signal
from sentinel.pipeline.strategy_detector import AlertContext

log = get_logger(__name__)


class RichNotifier(Protocol):
    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage: ...

    async def send_photo(
        self, png: bytes, caption: str = "", reply_to: int | None = None
    ) -> SentMessage: ...


class ReportWorker:
    def __init__(
        self,
        queue: asyncio.Queue[tuple[Signal, SentMessage]],
        notifier: RichNotifier,
        events: list[RiskEvent],
        events_horizon_days: int = 7,
        chart_bars: int = 120,
        chart_dir: Path | None = None,
    ) -> None:
        self.queue = queue
        self.notifier = notifier
        self.events = events
        self.horizon = events_horizon_days
        self.chart_bars = chart_bars
        self.chart_dir = chart_dir
        self.reports_sent = 0

    async def handle(self, sig: Signal, sent: SentMessage) -> None:
        ctx = sig.payload
        if not isinstance(ctx, AlertContext):
            return  # sonde de latence, alerte système… : pas de rapport
        now = datetime.fromtimestamp(sig.bar.close_time_ms / 1000, UTC)
        text = format_report(ctx, upcoming(self.events, now, self.horizon))
        report = await self.notifier.send_message(text, reply_to=sent.message_id)
        png = await asyncio.to_thread(render_chart, ctx, self.chart_bars)
        if self.chart_dir is not None:
            self.chart_dir.mkdir(parents=True, exist_ok=True)
            name = f"{sig.bar.symbol}_{sig.bar.timeframe}_{sig.bar.close_time_ms}.png"
            await asyncio.to_thread((self.chart_dir / name).write_bytes, png)
        await self.notifier.send_photo(
            png, caption=f"{sig.bar.symbol} — entrée, stop et repères", reply_to=report.message_id
        )
        self.reports_sent += 1

    async def run(self) -> None:
        while True:
            sig, sent = await self.queue.get()
            try:
                await self.handle(sig, sent)
            except Exception as e:
                log.error("report_failed", stream=str(sig.key), error=repr(e))
