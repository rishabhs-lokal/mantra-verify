import os
from typing import Literal, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="Ved API", version="2.1")

SHEETS_WEBAPP_URL = os.getenv("SHEETS_WEBAPP_URL", "").strip()
SHEETS_SHARED_SECRET = os.getenv("SHEETS_SHARED_SECRET", "").strip()
MOCK_MODE = not SHEETS_WEBAPP_URL


class SessionEvent(BaseModel):
    type: Literal["mantra", "meditation", "samadhan"]
    item_id: str
    count: int = Field(default=0, ge=0)
    user_id: str


class OfferingStats(BaseModel):
    ok: bool = True
    is_new_user: bool
    counts_30d: dict[str, int]
    recently_used_item_id: Optional[str] = None


@app.post("/api/session/start")
def start_session(event: SessionEvent):
    return {"ok": True, "event": "started", "session": event.model_dump()}


@app.post("/api/session/progress")
def save_progress(event: SessionEvent):
    return {"ok": True, "event": "progress_saved", "count": event.count}


@app.post("/api/session/complete")
def complete_session(event: SessionEvent):
    if not MOCK_MODE:
        _log_completion(event)
    return {"ok": True, "event": "completed", "count": event.count}


@app.get("/api/stats/{flow_type}", response_model=OfferingStats)
def get_stats(flow_type: Literal["mantra", "meditation", "samadhan"], user_id: str):
    if MOCK_MODE:
        return _mock_stats(flow_type)
    return _fetch_stats(flow_type, user_id)


def _log_completion(event: SessionEvent) -> None:
    try:
        httpx.post(
            SHEETS_WEBAPP_URL,
            json={
                "secret": SHEETS_SHARED_SECRET,
                "user_id": event.user_id,
                "type": event.type,
                "item_id": event.item_id,
                "count": event.count,
            },
            timeout=5.0,
        )
    except httpx.HTTPError:
        pass


def _fetch_stats(flow_type: str, user_id: str) -> OfferingStats:
    try:
        response = httpx.get(
            SHEETS_WEBAPP_URL,
            params={"secret": SHEETS_SHARED_SECRET, "user_id": user_id, "type": flow_type},
            timeout=5.0,
        )
        data = response.json()
        if data.get("ok"):
            return OfferingStats(**data)
    except (httpx.HTTPError, ValueError):
        pass
    return OfferingStats(is_new_user=True, counts_30d={}, recently_used_item_id=None)


def _mock_stats(flow_type: str) -> OfferingStats:
    sample_item = {"mantra": "shivaya", "meditation": "vagus", "samadhan": "love"}[flow_type]
    return OfferingStats(is_new_user=False, counts_30d={sample_item: 3}, recently_used_item_id=sample_item)
