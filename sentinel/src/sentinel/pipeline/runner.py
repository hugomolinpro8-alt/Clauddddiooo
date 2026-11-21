"""Chemin critique : bougie → indicateurs → détecteurs → envoi Telegram.

Règles appliquées ici :
  1. `process()` est SYNCHRONE : aucun `await`, donc aucune attente réseau/disque possible
     entre la réception d'une bougie et la décision. Coût mesuré : quelques dizaines de µs.
  2. L'envoi Telegram est lancé dans une tâche : si Telegram met 300 ms à répondre,
     les bougies suivantes continuent d'être traitées pendant ce temps.
  3. Tout ce qui est lent (journal SQLite, rapport n°2, graphique) consomme `post_queue`
     APRÈS l'envoi — jamais avant.
  4. Trou de données détecté → on suspend les signaux sur ce flux, on recharge les bougies
     manquantes en REST, on rejoue, puis on reprend. Mieux vaut pas de signal qu'un signal
     calculé sur des indicateurs faux.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from sentinel.alerts.telegram import SentMessage
from sentinel.core.logging import get_logger
from sentinel.core.models import Bar, StreamKey
from sentinel.data.watchdog import FeedWatchdog, WatchdogEvent
from sentinel.indicators.engine import GapDetected, IndicatorEngine, IndicatorSnapshot
from sentinel.pipeline.latency import LatencyRecorder

log = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Signal:
    key: StreamKey
    detector: str
    text: str
    bar: Bar
    snapshot: IndicatorSnapshot
    payload: Any = None  # AlertContext pour les stratégies (rapport n°2, graphique)


class Detector(Protocol):
    name: str

    def evaluate(self, snap: IndicatorSnapshot, bar: Bar) -> Signal | None: ...

    def warm(self, snap: IndicatorSnapshot, bar: Bar) -> None: ...


class Notifier(Protocol):
    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage: ...


Backfill = Callable[[StreamKey, int], Awaitable[list[Bar]]]


class ProbeDetector:
    """Détecteur de test : émet un signal à CHAQUE bougie clôturée.
    Sert uniquement à mesurer la latence de bout en bout (jamais activé en production)."""

    name = "probe"

    def warm(self, snap: IndicatorSnapshot, bar: Bar) -> None:
        return None

    def evaluate(self, snap: IndicatorSnapshot, bar: Bar) -> Signal | None:
        rsi = f"{snap.rsi:.1f}" if snap.rsi is not None else "n/a"
        atr = f"{snap.atr:.2f}" if snap.atr is not None else "n/a"
        text = f"[PROBE] {bar.key} close={bar.close} RSI={rsi} ATR={atr} trend={snap.trend}"
        return Signal(bar.key, self.name, text, bar, snap)


def stream_name(key: StreamKey) -> str:
    """Nom surveillé par le watchdog : un par (marché, symbole), toutes UT confondues."""
    return f"{key.market}:{key.symbol}"


class Pipeline:
    def __init__(
        self,
        engines: dict[StreamKey, IndicatorEngine],
        detectors: Sequence[Detector],
        notifier: Notifier,
        recorder: LatencyRecorder,
        watchdog: FeedWatchdog | None = None,
        backfill: Backfill | None = None,
        signal_mode: Literal["close", "intrabar"] = "close",
        require_ready: bool = True,
    ) -> None:
        self.engines = engines
        self.detectors = list(detectors)
        self.notifier = notifier
        self.recorder = recorder
        self.watchdog = watchdog
        self.backfill = backfill
        self.signal_mode = signal_mode
        self.require_ready = require_ready
        self.queue: asyncio.Queue[Bar] = asyncio.Queue()
        self.post_queue: asyncio.Queue[tuple[Signal, SentMessage]] = asyncio.Queue()
        self._resyncing: dict[StreamKey, list[Bar]] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self.bars_processed = 0
        self.alerts_sent = 0
        self.send_failures = 0

    # --- entrée des données (appelé par les flux, doit être non bloquant) ----------------
    def sink(self, bar: Bar) -> None:
        if self.watchdog is not None:
            self.watchdog.touch(stream_name(bar.key))
        self.queue.put_nowait(bar)

    async def run(self) -> None:
        while True:
            bar = await self.queue.get()
            self.process(bar)

    # --- chemin critique, 100 % synchrone ---------------------------------------------
    def process(self, bar: Bar) -> None:
        engine = self.engines.get(bar.key)
        if engine is None:
            return
        self.bars_processed += 1
        if bar.key in self._resyncing:
            if bar.closed:
                self._resyncing[bar.key].append(bar)
            return
        if bar.closed:
            try:
                snap = engine.update(bar)
            except GapDetected as gap:
                self._start_resync(engine, gap, bar)
                return
        elif self.signal_mode == "intrabar":
            snap = engine.preview(bar)
        else:
            return
        if snap is None or (self.require_ready and not snap.ready):
            return
        for det in self.detectors:
            sig = det.evaluate(snap, bar)
            if sig is not None:
                self._spawn(self._send(sig, time.perf_counter_ns()))

    # --- hors chemin critique ------------------------------------------------------------
    def _spawn(self, coro: Awaitable[None]) -> None:
        task: asyncio.Task[None] = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _send(self, sig: Signal, before_send_ns: int) -> None:
        try:
            sent = await self.notifier.send_message(sig.text)
        except Exception as e:
            self.send_failures += 1
            log.error("alert_send_failed", stream=str(sig.key), error=repr(e))
            return
        self.alerts_sent += 1
        self.recorder.record(sig.bar, before_send_ns, sent.sent_mono_ns)
        self.post_queue.put_nowait((sig, sent))

    def _start_resync(self, engine: IndicatorEngine, gap: GapDetected, bar: Bar) -> None:
        log.warning("gap_detected", stream=str(gap.key), expected=gap.expected_ms, got=gap.got_ms)
        self._resyncing[bar.key] = [bar]
        self._spawn(self._resync(engine, gap.expected_ms))

    async def _resync(self, engine: IndicatorEngine, from_ms: int) -> None:
        key = engine.key
        try:
            missing = await self.backfill(key, from_ms) if self.backfill else []
        except Exception as e:
            log.error("backfill_failed", stream=str(key), error=repr(e))
            missing = []
        pending = self._resyncing.pop(key, [])
        replay = sorted(
            {b.open_time_ms: b for b in [*missing, *pending]}.values(), key=lambda b: b.open_time_ms
        )
        for b in replay:
            try:
                engine.update(b)
            except GapDetected as gap:
                # Trou impossible à combler : on repart de zéro à partir de la dernière bougie
                # connue plutôt que de calculer sur une série trouée.
                log.error("gap_unfillable_reset", stream=str(key), expected=gap.expected_ms)
                engine.reset()
                engine.update(b)
        log.info("resync_done", stream=str(key), replayed=len(replay))

    async def on_watchdog(self, ev: WatchdogEvent) -> None:
        if ev.stale:
            text = (
                f"⚠️ FLUX COUPÉ — {ev.name}\n"
                f"Aucune donnée depuis {ev.silent_for_s:.0f} s. "
                "Les alertes sur cet actif sont suspendues jusqu'au retour du flux."
            )
        else:
            text = f"✅ FLUX RÉTABLI — {ev.name} (interruption ≈ {ev.silent_for_s:.0f} s)"
        log.warning("watchdog_event", name=ev.name, stale=ev.stale, silent_s=ev.silent_for_s)
        try:
            await self.notifier.send_message(text)
        except Exception as e:
            log.error("watchdog_alert_failed", error=repr(e))

    async def drain(self, timeout_s: float = 5.0) -> None:
        """Attend la fin des envois en cours (tests / arrêt propre)."""
        if self._tasks:
            await asyncio.wait(set(self._tasks), timeout=timeout_s)


def warm_up(
    engines: dict[StreamKey, IndicatorEngine],
    bars_by_key: dict[StreamKey, list[Bar]],
    detectors: Sequence[Detector],
) -> None:
    """Rejoue l'historique de TOUS les flux dans l'ordre chronologique de clôture (à égalité,
    l'unité de temps supérieure d'abord, comme dans le backtest). Ainsi une stratégie
    multi-UT voit, à chaque bougie de chauffe, le contexte tel qu'il était à ce moment-là."""
    events = sorted(
        (
            (b.close_time_ms, -k.timeframe.seconds, k, b)
            for k, bars in bars_by_key.items()
            for b in bars
        ),
        key=lambda e: (e[0], e[1]),
    )
    for _, _, key, bar in events:
        eng = engines[key]
        try:
            snap = eng.update(bar)
        except GapDetected:
            eng.reset()
            snap = eng.update(bar)
        if snap is not None:
            for det in detectors:
                det.warm(snap, bar)
