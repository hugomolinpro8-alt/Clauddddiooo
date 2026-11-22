"""Healthcheck Docker : `python -m sentinel.health` → code 0 si le pouls est récent.

Le processus réécrit data/heartbeat.json toutes les 15 s. Si le fichier a plus de
`max_age` secondes, la boucle asyncio est bloquée ou le processus est mort.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path


def check(path: Path = Path("data/heartbeat.json"), max_age: float = 90.0) -> int:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"unhealthy: pouls illisible ({e})")
        return 1
    age = time.time() - float(data.get("ts", 0))
    if age > max_age:
        print(f"unhealthy: pouls vieux de {age:.0f} s")
        return 1
    print(f"healthy: pouls {age:.0f} s, silence max {data.get('worst_silence_s')} s")
    return 0


if __name__ == "__main__":
    sys.exit(check())
