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


class BarObserver(Protocol):
    """Reçoit chaque bougie clôturée après mise à jour des indicateurs (ex. paper trading)."""

    def on_bar(self, snap: IndicatorSnapshot, bar: Bar) -> None: ...


# (signal, message envoyé ou None si muet, muet ?, mode observation ?)
OnSent = Callable[[Signal, SentMessage | None, bool, bool], None]
OpsLog = Callable[[str, str], None]

OBSERVATION_BANNER = (
    "⛔ MODE OBSERVATION — coupe-circuit atteint (drawdown papier). Signal fourni pour "
    "information : ne pas exécuter.\n"
)


class Gate:
    """Pause manuelle (/pause, /resume) et mode observation (coupe-circuit)."""

    def __init__(self, observation: Callable[[], bool] = lambda: False) -> None:
        self.paused = False
        self._observation = observation

    @property
    def observation(self) -> bool:
        return self._observation()


class ProbeDetector:
    """Détecteur de test : émet un signal à CHAQUE bougie clôturée.
    Sert uniquement à mesurer la latence de bout en bout (jamais activé en production)."""

    name = "probe"

    def warm(self, snap: IndicatorSnapshot, bar: Bar) -> None:
        return None

    def evaluate(self, snap: IndicatorSnapshot, bar: Bar) -> Signal | None:
        if not snap.ready:
            return None
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
        observers: Sequence[BarObserver] = (),
        gate: Gate | None = None,
        on_sent: Sequence[OnSent] = (),
        ops: OpsLog | None = None,
    ) -> None:
        self.engines = engines
        self.detectors = list(detectors)
        self.notifier = notifier
        self.recorder = recorder
        self.watchdog = watchdog
        self.backfill = backfill
        self.signal_mode = signal_mode
        self.observers = list(observers)
        self.gate = gate or Gate()
        self.on_sent = list(on_sent)
        self.ops: OpsLog = ops or (lambda _k, _d: None)
        self.alerts_muted = 0
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
            if snap is not None:
                for obs in self.observers:
                    obs.on_bar(snap, bar)
        elif self.signal_mode == "intrabar":
            snap = engine.preview(bar)
        else:
            return
        # Pas de filtre « indicateurs chauds » ici : chaque stratégie vérifie elle-même ce dont
        # elle a besoin. Filtrer ici priverait les stratégies de bougies et leur état
        # (canaux, bougie précédente) divergerait du backtest.
        if snap is None:
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
        if self.gate.paused:
            # En pause : rien n'est envoyé, mais le signal est journalisé (marqué muet) pour
            # mesurer ce que le système aurait fait.
            self.alerts_muted += 1
            for cb in self.on_sent:
                cb(sig, None, True, False)
            return
        observation = self.gate.observation
        text = OBSERVATION_BANNER + sig.text if observation else sig.text
        try:
            sent = await self.notifier.send_message(text)
        except Exception as e:
            self.send_failures += 1
            self.ops("send_failure", f"{sig.key}: {e!r}")
            log.error("alert_send_failed", stream=str(sig.key), error=repr(e))
            return
        self.alerts_sent += 1
        sample = self.recorder.record(sig.bar, before_send_ns, sent.sent_mono_ns)
        if sample.system_ms > self.recorder.target_ms:
            self.ops("latency_over_target", f"{sig.key}: {sample.system_ms:.0f} ms")
        for cb in self.on_sent:
            try:
                cb(sig, sent, False, observation)
            except Exception as e:
                log.error("on_sent_failed", error=repr(e))
        self.post_queue.put_nowait((sig, sent))

    def _start_resync(self, engine: IndicatorEngine, gap: GapDetected, bar: Bar) -> None:
        log.warning("gap_detected", stream=str(gap.key), expected=gap.expected_ms, got=gap.got_ms)
        self.ops("gap", f"{gap.key}: {gap.expected_ms} → {gap.got_ms}")
        self._resyncing[bar.key] = [bar]
        self._spawn(self._resync(engine, gap.expected_ms))

    async def _resync(self, engine: IndicatorEngine, from_ms: int) -> None:
        key = engine.key
        try:
            missing = await self.backfill(key, from_ms) if self.backfill else []
        except Exception as e:
            log.error("backfill_failed", stream=str(key), error=repr(e))
            self.ops("backfill_failed", f"{key}: {e!r}")
            missing = []
        pending = self._resyncing.pop(key, [])
        replay = sorted(
            {b.open_time_ms: b for b in [*missing, *pending]}.values(), key=lambda b: b.open_time_ms
        )
        for b in replay:
            try:
                snap = engine.update(b)
            except GapDetected as gap:
                # Trou impossible à combler : on repart de zéro à partir de la dernière bougie
                # connue plutôt que de calculer sur une série trouée.
                log.error("gap_unfillable_reset", stream=str(key), expected=gap.expected_ms)
                self.ops("gap_unfillable", str(key))
                engine.reset()
                snap = engine.update(b)
            if snap is None:
                continue
            # Les bougies rattrapées alimentent aussi stratégies et paper trading (sinon leur
            # état divergerait du backtest), mais ne déclenchent PAS d'alerte : un signal vieux
            # de plusieurs heures n'est plus actionnable.
            for det in self.detectors:
                det.warm(snap, b)
            for obs in self.observers:
                obs.on_bar(snap, b)
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
        self.ops("feed_stale" if ev.stale else "feed_recovered", ev.name)
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
    observers: Sequence[BarObserver] = (),
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
            for obs in observers:
                obs.on_bar(snap, bar)
