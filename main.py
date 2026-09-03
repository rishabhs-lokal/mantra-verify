"""FastAPI app for verifying spoken Hindu mantras against reference text.

Transcription is delegated to OpenRouter's cloud speech-to-text endpoint
(openai/whisper-large-v3) rather than running a model locally.
"""

import os
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

import counter
from matcher import PASS_THRESHOLD, normalize_text, score_match, word_diff

load_dotenv()

app = FastAPI(title="Mantra Verify")

OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
TRANSCRIPTION_MODEL = "openai/whisper-large-v3"

# Whisper has no dedicated Sanskrit language code; Hindi is the closest
# phonetic/script match for Devanagari mantra chanting and is what every
# transcription request below is hinted with.
TRANSCRIPTION_LANGUAGE = "hi"

_HTTP_TIMEOUT = httpx.Timeout(65.0, connect=10.0)


class VerifyResponse(BaseModel):
    score: float
    passed: bool
    count: int
    target_count: int
    remaining: int
    mala_complete: bool
    transcript: str
    reference_normalized: str
    spoken_normalized: str
    word_diff: list
    last_verified_at: Optional[str]


class CountResponse(BaseModel):
    session_id: str
    mantra_id: str
    count: int
    target_count: int
    remaining: int
    mala_complete: bool
    last_verified_at: Optional[str]


async def transcribe_audio(audio_bytes: bytes, filename: str, content_type: str) -> str:
    """Send audio to OpenRouter for transcription and return the transcript text.

    Raises HTTPException with a client-appropriate status code on any failure
    (missing API key, upstream auth/rate-limit/server errors, timeouts).
    """
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Server misconfiguration: OPENROUTER_API_KEY is not set.",
        )

    files = {"file": (filename, audio_bytes, content_type or "application/octet-stream")}
    data = {"model": TRANSCRIPTION_MODEL, "language": TRANSCRIPTION_LANGUAGE}
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            response = await client.post(
                OPENROUTER_TRANSCRIPTION_URL, headers=headers, data=data, files=files
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Transcription request timed out.")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach OpenRouter: {exc}")

    if response.status_code == 401:
        raise HTTPException(status_code=502, detail="OpenRouter rejected the API key.")
    if response.status_code == 429:
        raise HTTPException(
            status_code=429, detail="OpenRouter rate limit exceeded, please retry shortly."
        )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter transcription failed ({response.status_code}): {response.text[:300]}",
        )

    try:
        payload = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="OpenRouter returned a non-JSON response.")

    transcript = (payload.get("text") or "").strip()
    if not transcript:
        raise HTTPException(
            status_code=422,
            detail="Transcription returned empty text — re-record with clearer audio.",
        )
    return transcript


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/verify", response_model=VerifyResponse)
async def verify(
    audio: UploadFile = File(...),
    reference_text: str = Form(...),
    session_id: str = Form(...),
    mantra_id: str = Form(...),
    target_count: int = Form(108),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    transcript = await transcribe_audio(audio_bytes, audio.filename or "audio.wav", audio.content_type)

    score = score_match(reference_text, transcript)
    passed = score >= PASS_THRESHOLD

    if passed:
        count, last_verified_at = counter.increment(session_id, mantra_id)
    else:
        count, last_verified_at = counter.get_count(session_id, mantra_id)

    remaining = max(target_count - count, 0)

    return VerifyResponse(
        score=score,
        passed=passed,
        count=count,
        target_count=target_count,
        remaining=remaining,
        mala_complete=count >= target_count,
        transcript=transcript,
        reference_normalized=normalize_text(reference_text),
        spoken_normalized=normalize_text(transcript),
        word_diff=word_diff(reference_text, transcript),
        last_verified_at=last_verified_at,
    )


@app.get("/count/{session_id}", response_model=CountResponse)
async def get_count(session_id: str, mantra_id: str, target_count: int = 108):
    count, last_verified_at = counter.get_count(session_id, mantra_id)
    remaining = max(target_count - count, 0)
    return CountResponse(
        session_id=session_id,
        mantra_id=mantra_id,
        count=count,
        target_count=target_count,
        remaining=remaining,
        mala_complete=count >= target_count,
        last_verified_at=last_verified_at,
    )


@app.post("/count/{session_id}/reset")
async def reset_count(session_id: str, mantra_id: str):
    counter.reset(session_id, mantra_id)
    return {
        "session_id": session_id,
        "mantra_id": mantra_id,
        "count": 0,
        "last_verified_at": None,
    }
