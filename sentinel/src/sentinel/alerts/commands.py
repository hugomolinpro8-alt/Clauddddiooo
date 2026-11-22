"""Commandes Telegram : /status, /watchlist, /wallets, /pause, /resume, /stats, /weekly, /help.

Sécurité : seules les commandes venant de TON chat_id sont exécutées. Toute autre origine
est ignorée et journalisée — sinon n'importe qui trouvant le bot pourrait le mettre en pause.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from sentinel.alerts.telegram import SentMessage
from sentinel.core.logging import get_logger
from sentinel.core.models import Market
from sentinel.data.watchdog import FeedWatchdog
from sentinel.journal.db import JournalWriter
from sentinel.paper.reporting import positions_block, stats_text
from sentinel.paper.tracker import PaperTracker
from sentinel.pipeline.latency import LatencyRecorder
from sentinel.pipeline.runner import Gate

log = get_logger(__name__)


class CommandTransport(Protocol):
    async def send_message(self, text: str, reply_to: int | None = None) -> SentMessage: ...

    async def get_updates(
        self, offset: int | None, timeout_s: int = 30
    ) -> list[dict[str, Any]]: ...


@dataclass
class CommandContext:
    gate: Gate
    tracker: PaperTracker
    writer: JournalWriter
    recorder: LatencyRecorder
    watchdog: FeedWatchdog | None
    watchlist: list[str]
    markets: list[Market]
    timeframes: list[str]
    strategies: Mapping[str, list[Market]]
    ref_means: Mapping[str, float]
    started_mono: float
    weekly: Callable[[], Awaitable[str]]


HELP = (
    "Commandes :\n"
    "/status — état du bot, des flux, latence, positions papier\n"
    "/stats — performance paper trading vs backtest\n"
    "/watchlist — actifs, marchés, stratégies actives\n"
    "/wallets — portefeuilles smart money suivis\n"
    "/pause — suspendre l'envoi des alertes (le paper trading continue)\n"
    "/resume — reprendre ; /resume coupe-circuit — réarmer après un coupe-circuit\n"
    "/weekly — rapport hebdomadaire maintenant\n"
    "/help — cette aide"
)


class Commands:
    def __init__(self, ctx: CommandContext) -> None:
        self.c = ctx

    async def handle(self, text: str) -> str:
        parts = text.strip().split()
        if not parts or not parts[0].startswith("/"):
            return "Commande inconnue. /help"
        cmd = parts[0][1:].split("@")[0].lower()
        args = parts[1:]
        handler = getattr(self, f"cmd_{cmd}", None)
        if handler is None:
            return f"Commande inconnue : /{cmd}. /help"
        out: str = await handler(args)
        return out

    async def cmd_help(self, _a: list[str]) -> str:
        return HELP

    async def cmd_start(self, _a: list[str]) -> str:
        return HELP

    async def cmd_status(self, _a: list[str]) -> str:
        c = self.c
        up = time.monotonic() - c.started_mono
        mode = (
            "⏸️ PAUSE"
            if c.gate.paused
            else "⛔ OBSERVATION (coupe-circuit)"
            if c.gate.observation
            else "✅ actif"
        )
        L = [f"🛰️ STATUT — {mode}", f"En ligne depuis {up / 3600:.1f} h".replace(".", ",")]
        if c.watchdog is not None:
            sil = c.watchdog.silence()
            stale = c.watchdog.stale
            L.append(
                "Flux : "
                + ", ".join(
                    f"{n} {'⚠️ coupé' if n in stale else 'ok'} ({s:.0f} s)"
                    for n, s in sorted(sil.items())
                )
            )
        lat = c.recorder.summary()
        if lat.get("n"):
            L.append(
                f"Latence alertes : p50 {lat['system_ms_p50']:.0f} ms, p99 "
                f"{lat['system_ms_p99']:.0f} ms sur {int(lat['n'])} alertes"
            )
        else:
            L.append("Latence alertes : aucune alerte depuis le démarrage")
        if c.writer.failures:
            L.append(f"⚠️ {c.writer.failures} échec(s) d'écriture du journal")
        t = c.tracker
        L.append(
            f"Équité papier {t.equity():.2f} €, drawdown {t.drawdown() * 100:.1f} %, risque "
            f"ouvert {t.open_risk_pct():.2f} %".replace(".", ",")
        )
        L += ["Positions papier :", *positions_block(t)]
        return "\n".join(L)

    async def cmd_watchlist(self, _a: list[str]) -> str:
        c = self.c
        strat = (
            "; ".join(f"{n} ({', '.join(m.value for m in ms)})" for n, ms in c.strategies.items())
            or "aucune"
        )
        return (
            f"👀 Watchlist : {', '.join(c.watchlist)}\n"
            f"Marchés : {', '.join(m.value for m in c.markets)}\n"
            f"Unités de temps : {', '.join(c.timeframes)}\n"
            f"Stratégies actives : {strat}"
        )

    async def cmd_wallets(self, _a: list[str]) -> str:
        return (
            "🐋 Smart money : module non actif (phase 6). Aucun portefeuille suivi. "
            "Il ne sera ajouté qu'avec des portefeuilles sélectionnés et rejoués sur 90 jours."
        )

    async def cmd_pause(self, _a: list[str]) -> str:
        self.c.gate.paused = True
        self.c.writer.put("set_state", "paused", True)
        return (
            "⏸️ Alertes suspendues. Les signaux restent calculés et suivis en paper trading "
            "(marqués « muets »). /resume pour reprendre."
        )

    async def cmd_resume(self, args: list[str]) -> str:
        c = self.c
        if args and args[0].lower() in ("coupe-circuit", "breaker"):
            if not c.tracker.breaker_tripped:
                return "Le coupe-circuit n'est pas déclenché."
            c.tracker.breaker_tripped = False
            c.tracker.peak_equity = c.tracker.equity()  # réarmé au niveau actuel
            c.writer.put("set_state", "breaker", False)
            c.writer.put("set_state", "peak_equity", c.tracker.peak_equity)
            return (
                "🔄 Coupe-circuit réarmé au niveau d'équité actuel. Avant de reprendre, "
                "relis /stats : la cause du drawdown est-elle comprise ?"
            )
        c.gate.paused = False
        c.writer.put("set_state", "paused", False)
        extra = (
            (
                "\n⛔ Attention : le coupe-circuit reste actif (mode observation). "
                "/resume coupe-circuit pour le réarmer."
            )
            if c.gate.observation
            else ""
        )
        return "▶️ Alertes reprises." + extra

    async def cmd_stats(self, _a: list[str]) -> str:
        return stats_text(self.c.tracker, self.c.strategies, self.c.ref_means)

    async def cmd_weekly(self, _a: list[str]) -> str:
        return await self.c.weekly()


class CommandBot:
    def __init__(self, transport: CommandTransport, chat_id: str, commands: Commands) -> None:
        self.t = transport
        self.chat_id = str(chat_id)
        self.commands = commands
        self.offset: int | None = None
        self.started_s = time.time()
        self.handled = 0
        self.rejected = 0

    async def poll_once(self, timeout_s: int = 30) -> None:
        for u in await self.t.get_updates(self.offset, timeout_s):
            self.offset = int(u["update_id"]) + 1
            msg = u.get("message") or {}
            chat = str((msg.get("chat") or {}).get("id", ""))
            text = msg.get("text") or ""
            if chat != self.chat_id:
                self.rejected += 1
                log.warning("command_unauthorized_chat", chat=chat)
                continue
            if int(msg.get("date", 0)) < self.started_s - 300:
                continue  # commande ancienne (bot éteint) : ignorée, pour ne pas rejouer un /pause
            if not text.startswith("/"):
                continue
            try:
                reply = await self.commands.handle(text)
            except Exception as e:
                log.error("command_failed", command=text, error=repr(e))
                reply = "Erreur pendant la commande (voir les logs)."
            self.handled += 1
            await self.t.send_message(reply, reply_to=msg.get("message_id"))

    async def run(self) -> None:
        while True:
            await self.poll_once()
