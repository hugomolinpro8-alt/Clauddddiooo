"""Persistance SQLite : annonces vues, achats, état de l'application."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .models import Item

SCHEMA = """
CREATE TABLE IF NOT EXISTS seen_items (
    item_id      INTEGER PRIMARY KEY,
    search_name  TEXT NOT NULL,
    first_seen   TEXT NOT NULL,
    title        TEXT,
    price        REAL,
    matched      INTEGER NOT NULL DEFAULT 0,
    ignored      INTEGER NOT NULL DEFAULT 0,
    data_json    TEXT
);
CREATE TABLE IF NOT EXISTS purchases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL,
    search_name  TEXT,
    title        TEXT,
    seller       TEXT,
    amount       REAL NOT NULL,
    currency     TEXT,
    mode         TEXT NOT NULL,      -- simulation | real
    trigger      TEXT NOT NULL,      -- auto | manual
    status       TEXT NOT NULL,      -- simulated | done | failed | pending
    details      TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

# Statuts qui comptent dans les budgets (un échec ne coûte rien).
SPENT_STATUSES = ("simulated", "done", "pending")


class Storage:
    def __init__(self, path: Path, tz: str = "Europe/Paris"):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.tz = ZoneInfo(tz)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        self._db.commit()

    def now(self) -> datetime:
        return datetime.now(self.tz)

    # ------------------------------------------------------------ seen
    def is_seen(self, item_id: int) -> bool:
        with self._lock:
            row = self._db.execute(
                "SELECT 1 FROM seen_items WHERE item_id=?", (item_id,)
            ).fetchone()
        return row is not None

    def mark_seen(self, item: Item, search_name: str, matched: bool) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR IGNORE INTO seen_items"
                "(item_id, search_name, first_seen, title, price, matched, data_json)"
                " VALUES (?,?,?,?,?,?,?)",
                (item.id, search_name, self.now().isoformat(), item.title,
                 item.price, int(matched),
                 json.dumps(item.raw, ensure_ascii=False) if matched else None),
            )
            self._db.commit()

    def get_item_raw(self, item_id: int) -> tuple[str, dict] | None:
        with self._lock:
            row = self._db.execute(
                "SELECT search_name, data_json FROM seen_items WHERE item_id=?",
                (item_id,),
            ).fetchone()
        if not row or not row["data_json"]:
            return None
        return row["search_name"], json.loads(row["data_json"])

    def mark_ignored(self, item_id: int) -> None:
        with self._lock:
            self._db.execute("UPDATE seen_items SET ignored=1 WHERE item_id=?", (item_id,))
            self._db.commit()

    def count_seen(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM seen_items").fetchone()[0]

    def prune_seen(self, keep_days: int = 60) -> int:
        """Purge les vieilles annonces non retenues pour garder la base légère."""
        cutoff = (self.now() - timedelta(days=keep_days)).isoformat()
        with self._lock:
            cur = self._db.execute(
                "DELETE FROM seen_items WHERE matched=0 AND first_seen < ?", (cutoff,)
            )
            self._db.commit()
            return cur.rowcount

    # ------------------------------------------------------------ purchases
    def record_purchase(self, item: Item, search_name: str, mode: str, trigger: str,
                        status: str, details: str = "") -> int:
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO purchases(item_id, search_name, title, seller, amount,"
                " currency, mode, trigger, status, details, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (item.id, search_name, item.title, item.seller_login, item.total_price,
                 item.currency, mode, trigger, status, details, self.now().isoformat()),
            )
            self._db.commit()
            return cur.lastrowid

    def update_purchase(self, purchase_id: int, status: str, details: str = "") -> None:
        with self._lock:
            self._db.execute(
                "UPDATE purchases SET status=?, details=? WHERE id=?",
                (status, details, purchase_id),
            )
            self._db.commit()

    def already_bought(self, item_id: int, mode: str) -> bool:
        with self._lock:
            row = self._db.execute(
                f"SELECT 1 FROM purchases WHERE item_id=? AND mode=? AND status IN "
                f"({','.join('?' * len(SPENT_STATUSES))})",
                (item_id, mode, *SPENT_STATUSES),
            ).fetchone()
        return row is not None

    def start_of_day(self) -> datetime:
        return self.now().replace(hour=0, minute=0, second=0, microsecond=0)

    def spent_since(self, since: datetime, mode: str) -> float:
        with self._lock:
            row = self._db.execute(
                f"SELECT COALESCE(SUM(amount),0) FROM purchases WHERE mode=? "
                f"AND created_at >= ? AND status IN ({','.join('?' * len(SPENT_STATUSES))})",
                (mode, since.isoformat(), *SPENT_STATUSES),
            ).fetchone()
        return float(row[0])

    def auto_buys_today(self, search_name: str, mode: str) -> int:
        with self._lock:
            row = self._db.execute(
                f"SELECT COUNT(*) FROM purchases WHERE mode=? AND trigger='auto' "
                f"AND search_name=? AND created_at >= ? "
                f"AND status IN ({','.join('?' * len(SPENT_STATUSES))})",
                (mode, search_name, self.start_of_day().isoformat(), *SPENT_STATUSES),
            ).fetchone()
        return int(row[0])

    def recent_purchases(self, limit: int = 10) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(
                "SELECT * FROM purchases ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()

    # ------------------------------------------------------------ kv
    def get(self, key: str, default: str | None = None) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def set(self, key: str, value: str | None) -> None:
        with self._lock:
            if value is None:
                self._db.execute("DELETE FROM kv WHERE key=?", (key,))
            else:
                self._db.execute(
                    "INSERT INTO kv(key, value) VALUES(?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, value),
                )
            self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()
