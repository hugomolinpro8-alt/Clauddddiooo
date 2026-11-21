"""Mesure de latence par alerte.

Deux chiffres, parce qu'ils ne mesurent pas la même chose :
  - system_ms   : réception du message WebSocket → réponse de Telegram, sur l'horloge
                  monotone locale. C'est NOTRE responsabilité (objectif < 500 ms).
                  Inclut l'aller-retour réseau vers Telegram, mais pas le réseau Binance.
  - exchange_ms : horodatage Binance (champ E) → réponse Telegram, sur l'horloge murale.
                  Ajoute le trajet Binance → nous, mais dépend de la synchro NTP : un
                  décalage d'horloge de 300 ms fausse ce chiffre de 300 ms.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from sentinel.core.logging import get_logger
from sentinel.core.models import Bar

log = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class LatencySample:
    stream: str
    system_ms: float
    exchange_ms: float
    process_ms: float  # réception → juste avant l'envoi HTTP (notre code pur)


@dataclass
class LatencyRecorder:
    target_ms: float = 500.0
    samples: list[LatencySample] = field(default_factory=list)

    def record(self, bar: Bar, before_send_ns: int, sent_mono_ns: int) -> LatencySample:
        s = LatencySample(
            stream=str(bar.key),
            system_ms=(sent_mono_ns - bar.recv_mono_ns) / 1e6,
            exchange_ms=float(time.time_ns() // 1_000_000 - bar.event_time_ms),
            process_ms=(before_send_ns - bar.recv_mono_ns) / 1e6,
        )
        self.samples.append(s)
        level = "warning" if s.system_ms > self.target_ms else "info"
        getattr(log, level)(
            "alert_latency",
            stream=s.stream,
            system_ms=round(s.system_ms, 2),
            exchange_ms=round(s.exchange_ms, 1),
            process_ms=round(s.process_ms, 3),
        )
        return s

    def summary(self) -> dict[str, float]:
        if not self.samples:
            return {"n": 0}
        out: dict[str, float] = {"n": float(len(self.samples))}
        for name in ("process_ms", "system_ms", "exchange_ms"):
            arr = np.array([getattr(s, name) for s in self.samples])
            out[f"{name}_p50"] = float(np.percentile(arr, 50))
            out[f"{name}_p95"] = float(np.percentile(arr, 95))
            out[f"{name}_p99"] = float(np.percentile(arr, 99))
            out[f"{name}_max"] = float(arr.max())
        return out
