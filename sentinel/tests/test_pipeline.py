from __future__ import annotations

import asyncio

from sentinel.alerts.console import ConsoleNotifier
from sentinel.alerts.telegram import SentMessage
from sentinel.core.config import IndicatorConfig
from sentinel.core.models import Bar, StreamKey
from sentinel.data.watchdog import WatchdogEvent
from sentinel.indicators.engine import IndicatorEngine
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import Pipeline, ProbeDetector
from tests.helpers import KEY, random_bars


class RecordingNotifier(ConsoleNotifier):
    def __init__(self) -> None:
        super().__init__()
        self.texts: list[str] = []

    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage:
        self.texts.append(text)
        return await super().send_message(text, reply_to)


async def test_gap_triggers_backfill_and_replay() -> None:
    bars = random_bars(320)
    engine = IndicatorEngine(KEY, IndicatorConfig())
    for b in bars[:300]:
        engine.update(b)
    requested: list[tuple[StreamKey, int]] = []

    async def backfill(key: StreamKey, start: int) -> list[Bar]:
        requested.append((key, start))
        await asyncio.sleep(0.01)
        return [b for b in bars if b.open_time_ms >= start][:15]  # 300..314

    notifier = RecordingNotifier()
    pipe = Pipeline(
        {KEY: engine}, [ProbeDetector()], notifier, LatencyRecorder(), backfill=backfill
    )
    pipe.process(bars[315])  # 300..314 manquants → trou
    pipe.process(bars[316])  # arrive pendant la resynchro : mis de côté, pas de signal
    await pipe.drain()
    assert requested == [(KEY, bars[300].open_time_ms)]
    assert engine.last_open_ms == bars[316].open_time_ms
    assert engine.bars_seen == 317
    assert notifier.texts == []  # aucun signal émis pendant/au sujet de la resynchro
    pipe.process(bars[317])
    await pipe.drain()
    assert len(notifier.texts) == 1

    # Les indicateurs après resynchro sont identiques à un calcul sans coupure.
    ref = IndicatorEngine(KEY, IndicatorConfig())
    for b in bars[:318]:
        ref.update(b)
    assert ref.last == engine.last


async def test_no_signal_before_indicators_ready() -> None:
    bars = random_bars(50)
    notifier = RecordingNotifier()
    pipe = Pipeline(
        {KEY: IndicatorEngine(KEY, IndicatorConfig())},
        [ProbeDetector()],
        notifier,
        LatencyRecorder(),
    )
    for b in bars:
        pipe.process(b)
    await pipe.drain()
    assert notifier.texts == []


async def test_watchdog_message_wording() -> None:
    notifier = RecordingNotifier()
    pipe = Pipeline({}, [], notifier, LatencyRecorder())
    await pipe.on_watchdog(WatchdogEvent("spot:BTCUSDT", True, 61))
    await pipe.on_watchdog(WatchdogEvent("spot:BTCUSDT", False, 125))
    assert notifier.texts[0].startswith("⚠️ FLUX COUPÉ — spot:BTCUSDT")
    assert notifier.texts[1].startswith("✅ FLUX RÉTABLI")
