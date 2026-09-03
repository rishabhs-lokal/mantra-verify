"""Per-session verification history, persisted to a JSON file.

Feeds Vyas's chat replies with real context about a person's practice so
conversation isn't stateless — same single-process/JSON-file caveat as
counter.py (see its module docstring for the SQLite/Redis migration note);
this would need the same treatment before running multi-worker.
"""

import json
import threading
from pathlib import Path

DATA_PATH = Path(__file__).parent / "data" / "history.json"

_lock = threading.Lock()

# Bounds how much a single session's history file can grow; Vyas only ever
# reads the last few entries anyway (see get_recent), so older ones would
# just be dead weight on disk.
_MAX_ENTRIES_PER_SESSION = 50


def _load() -> dict:
    if not DATA_PATH.exists():
        return {}
    with DATA_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: dict) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def log_verification(
    session_id: str,
    mantra_id: str,
    score: float,
    passed: bool,
    completion_ratio: float,
    timestamp: str,
) -> None:
    """Record one /verify attempt (pass or fail) for later context."""
    with _lock:
        data = _load()
        entries = data.get(session_id, [])
        entries.append(
            {
                "mantra_id": mantra_id,
                "score": score,
                "passed": passed,
                "completion_ratio": completion_ratio,
                "timestamp": timestamp,
            }
        )
        data[session_id] = entries[-_MAX_ENTRIES_PER_SESSION:]
        _save(data)


def get_recent(session_id: str, limit: int = 5) -> list:
    with _lock:
        data = _load()
        return data.get(session_id, [])[-limit:]
