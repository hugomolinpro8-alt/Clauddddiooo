from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest

from sentinel.app import seconds_until_weekly
from sentinel.health import check


def test_health_fresh_stale_missing(tmp_path: Path) -> None:
    hb = tmp_path / "hb.json"
    assert check(hb) == 1  # absent
    hb.write_text(json.dumps({"ts": time.time(), "worst_silence_s": 1.0}))
    assert check(hb) == 0
    hb.write_text(json.dumps({"ts": time.time() - 500}))
    assert check(hb) == 1


def test_daily_schedule() -> None:
    now = datetime(2026, 11, 22, 9, 0, tzinfo=UTC)
    assert seconds_until_weekly(now, None, 8) == pytest.approx(23 * 3600)
    assert seconds_until_weekly(now, None, 10) == pytest.approx(3600)


def test_dockerignore_excludes_secrets() -> None:
    ignored = Path(__file__).parents[1].joinpath(".dockerignore").read_text().split()
    assert ".env" in ignored and "*.env" in ignored and "data" in ignored
