from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Ved API", version="2.0")


class SessionEvent(BaseModel):
    type: Literal["mantra", "meditation", "samadhan"]
    item_id: str
    count: int = Field(default=0, ge=0)


@app.post("/api/session/start")
def start_session(event: SessionEvent):
    return {"ok": True, "event": "started", "session": event.model_dump()}


@app.post("/api/session/progress")
def save_progress(event: SessionEvent):
    return {"ok": True, "event": "progress_saved", "count": event.count}


@app.post("/api/session/complete")
def complete_session(event: SessionEvent):
    return {"ok": True, "event": "completed", "count": event.count}
