from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

# Voice-verified mantra japa counting (transcription, matching, Vyas's
# chat/TTS persona). Requires `pip install -r requirements.txt` in this
# backend's venv (installs vyas via the editable `-e ../..` entry pointing
# at the repo root), and OPENROUTER_API_KEY set in this process's
# environment — vyas reads it at request time but never calls
# load_dotenv() itself, so this app's own env setup is what's authoritative.
from vyas import router as vyas_router

app = FastAPI(title="Ved API", version="2.0")
app.include_router(vyas_router, prefix="/api/vyas", tags=["vyas"])


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
