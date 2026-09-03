"""Per-session, per-mantra repetition counting, persisted to a JSON file.

NOTE: single-process only. The lock below guards against races between
threads/requests within one process, but if this app is ever run with
multiple worker processes (e.g. `uvicorn --workers N` or gunicorn),
each worker gets its own in-memory copy and last-writer-wins on the JSON
file, silently dropping counts. Migrate to SQLite or Redis before scaling
past a single worker — increment/get_count/reset below are the only three
functions that would need new bodies; callers don't touch the storage
format directly.
"""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

DATA_PATH = Path(__file__).parent / "data" / "counts.json"

_lock = threading.Lock()


def _load() -> dict:
    if not DATA_PATH.exists():
        return {}
    with DATA_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: dict) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _key(session_id: str, mantra_id: str) -> str:
    return f"{session_id}:{mantra_id}"


def increment(session_id: str, mantra_id: str) -> tuple:
    """Increment the count by 1 for this session+mantra on a passing verification.

    Returns (count, last_verified_at).
    """
    return increment_by(session_id, mantra_id, 1)


def increment_by(session_id: str, mantra_id: str, n: int) -> tuple:
    """Add n repetitions at once — e.g. from a single recording detected to
    contain n repeats of the mantra back-to-back, rather than one recording
    per repetition. Returns (count, last_verified_at); last_verified_at is
    only updated if n > 0.
    """
    with _lock:
        data = _load()
        key = _key(session_id, mantra_id)
        entry = data.get(key, {"count": 0, "last_verified_at": None})
        entry["count"] += n
        if n > 0:
            entry["last_verified_at"] = datetime.now(timezone.utc).isoformat()
        data[key] = entry
        _save(data)
        return entry["count"], entry["last_verified_at"]


def get_count(session_id: str, mantra_id: str) -> tuple:
    """Return (count, last_verified_at) for this session+mantra, defaulting to (0, None)."""
    with _lock:
        data = _load()
        entry = data.get(_key(session_id, mantra_id), {"count": 0, "last_verified_at": None})
        return entry["count"], entry["last_verified_at"]


def reset(session_id: str, mantra_id: str) -> None:
    with _lock:
        data = _load()
        data.pop(_key(session_id, mantra_id), None)
        _save(data)
