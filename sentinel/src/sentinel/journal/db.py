"""Journal SQLite : alertes envoyées, trades papier, événements d'exploitation, état.

Toutes les écritures passent par une FILE consommée par une tâche dédiée (`JournalWriter`) :
le chemin critique ne touche jamais le disque. SQLite en mode WAL : lectures (commandes
Telegram, rapport hebdo) possibles pendant les écritures.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiosqlite

from sentinel.core.logging import get_logger

log = get_logger(__name__)

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_ms INTEGER NOT NULL,
    strategy TEXT NOT NULL, market TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
    signal_close REAL NOT NULL, stop REAL NOT NULL, risk_pct REAL NOT NULL,
    telegram_msg_id INTEGER, latency_ms REAL, muted INTEGER NOT NULL DEFAULT 0,
    observation INTEGER NOT NULL DEFAULT 0, text TEXT, score REAL, regime TEXT,
    smart_money TEXT
);
CREATE TABLE IF NOT EXISTS paper_trades (
    id INTEGER PRIMARY KEY,
    alert_id INTEGER, strategy TEXT NOT NULL, market TEXT NOT NULL, symbol TEXT NOT NULL,
    side TEXT NOT NULL, status TEXT NOT NULL, created_ms INTEGER NOT NULL,
    risk_amount REAL NOT NULL, entry_ms INTEGER, entry REAL, exit_ms INTEGER,
    exit_reason TEXT, r_net REAL, r_gross REAL, pnl_eur REAL, last_bar_ms INTEGER NOT NULL,
    state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_status ON paper_trades(status);
CREATE TABLE IF NOT EXISTS ops_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, kind TEXT NOT NULL,
    detail TEXT
);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


@dataclass(frozen=True, slots=True)
class PaperRow:
    id: int
    alert_id: int | None
    strategy: str
    market: str
    symbol: str
    side: str
    status: str
    created_ms: int
    risk_amount: float
    entry_ms: int | None
    entry: float | None
    exit_ms: int | None
    exit_reason: str | None
    r_net: float | None
    r_gross: float | None
    pnl_eur: float | None
    last_bar_ms: int
    state: str


class Journal:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._db: aiosqlite.Connection | None = None

    async def open(self) -> Journal:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.path)
        await self._db.executescript(SCHEMA)
        await self._db.commit()
        return self

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("journal non ouvert")
        return self._db

    # --- écritures --------------------------------------------------------------------
    async def insert_alert(self, row: dict[str, Any]) -> int:
        cols = ", ".join(row)
        q = ", ".join("?" for _ in row)
        cur = await self.db.execute(
            f"INSERT INTO alerts ({cols}) VALUES ({q})", tuple(row.values())
        )
        await self.db.commit()
        return int(cur.lastrowid or 0)

    async def upsert_paper(self, row: dict[str, Any]) -> None:
        cols = ", ".join(row)
        q = ", ".join("?" for _ in row)
        upd = ", ".join(f"{k}=excluded.{k}" for k in row if k != "id")
        await self.db.execute(
            f"INSERT INTO paper_trades ({cols}) VALUES ({q}) ON CONFLICT(id) DO UPDATE SET {upd}",
            tuple(row.values()),
        )
        await self.db.commit()

    async def log_ops(self, ts_ms: int, kind: str, detail: str = "") -> None:
        await self.db.execute(
            "INSERT INTO ops_events (ts_ms, kind, detail) VALUES (?, ?, ?)", (ts_ms, kind, detail)
        )
        await self.db.commit()

    async def set_state(self, key: str, value: Any) -> None:
        await self.db.execute(
            "INSERT INTO state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
        await self.db.commit()

    # --- lectures ----------------------------------------------------------------------
    async def get_state(self, key: str, default: Any = None) -> Any:
        async with self.db.execute("SELECT value FROM state WHERE key=?", (key,)) as cur:
            row = await cur.fetchone()
        return json.loads(row[0]) if row else default

    async def paper(self, statuses: tuple[str, ...] | None = None) -> list[PaperRow]:
        q = "SELECT * FROM paper_trades"
        args: tuple[Any, ...] = ()
        if statuses:
            q += f" WHERE status IN ({', '.join('?' for _ in statuses)})"
            args = statuses
        async with self.db.execute(q + " ORDER BY id", args) as cur:
            rows = await cur.fetchall()
        return [PaperRow(*r) for r in rows]

    async def max_id(self, table: str) -> int:
        if table not in ("alerts", "paper_trades"):
            raise ValueError(table)
        async with self.db.execute(f"SELECT COALESCE(MAX(id), 0) FROM {table}") as cur:
            row = await cur.fetchone()
        return int(row[0]) if row else 0

    async def ops_counts(self, since_ms: int) -> dict[str, int]:
        async with self.db.execute(
            "SELECT kind, COUNT(*) FROM ops_events WHERE ts_ms >= ? GROUP BY kind", (since_ms,)
        ) as cur:
            rows = await cur.fetchall()
        return {str(k): int(n) for k, n in rows}

    async def alerts_since(self, since_ms: int) -> int:
        async with self.db.execute(
            "SELECT COUNT(*) FROM alerts WHERE created_ms >= ?", (since_ms,)
        ) as cur:
            row = await cur.fetchone()
        return int(row[0]) if row else 0


class JournalWriter:
    """Consomme une file d'écritures (nom de méthode, arguments) et les exécute dans l'ordre.
    Une erreur d'écriture est journalisée sans arrêter le bot."""

    def __init__(self, journal: Journal) -> None:
        self.journal = journal
        self.queue: asyncio.Queue[tuple[str, tuple[Any, ...]]] = asyncio.Queue()
        self.failures = 0

    def put(self, method: str, *args: Any) -> None:
        self.queue.put_nowait((method, args))

    async def run(self) -> None:
        while True:
            method, args = await self.queue.get()
            try:
                await getattr(self.journal, method)(*args)
            except Exception as e:
                self.failures += 1
                log.error("journal_write_failed", method=method, error=repr(e))
            finally:
                self.queue.task_done()

    async def flush(self) -> None:
        await self.queue.join()
