"""FastAPI app for verifying spoken Hindu mantras against reference text,
plus Vyas: a conversational sage character who talks through the practice.

Transcription, chat, and voice synthesis are all delegated to OpenRouter's
cloud APIs (openai/whisper-large-v3, a chat model, and a TTS model
respectively) rather than running anything locally.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import counter
import history
import vyas
from matcher import (
    AI_REVIEW_LOWER_BOUND,
    PASS_THRESHOLD,
    completion_stats,
    count_repetitions,
    normalize_text,
    score_match,
    word_diff,
)
from openrouter_client import post as openrouter_post
from openrouter_client import require_api_key

load_dotenv()

app = FastAPI(title="Mantra Verify")

OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
TRANSCRIPTION_MODEL = "openai/whisper-large-v3"

# Whisper has a dedicated Sanskrit code ("sa"), but it's a low-resource
# language for Whisper's training data — Hindi ("hi") is the default here
# since it's better-supported and phonetically close to Devanagari mantra
# chanting; pass a different `language` value per-request to compare.
TRANSCRIPTION_LANGUAGE = "hi"


class VerifyResponse(BaseModel):
    score: float
    completion_ratio: float
    passed: bool
    count: int
    target_count: int
    remaining: int
    mala_complete: bool
    transcript: str
    reference_normalized: str
    spoken_normalized: str
    word_diff: list
    words_matched: int
    words_expected: int
    last_verified_at: Optional[str]


class VerifyBatchResponse(BaseModel):
    detected_repetitions: int
    count: int
    target_count: int
    remaining: int
    mala_complete: bool
    transcript: str
    reference_normalized: str
    segments: list
    last_verified_at: Optional[str]


class VerifyChantResponse(BaseModel):
    counted: bool
    decision_source: str  # "fuzzy_pass" | "fuzzy_fail" | "ai_judged" | "empty_transcript"
    score: float
    transcript: str
    count: int
    target_count: int
    remaining: int
    mala_complete: bool
    last_verified_at: Optional[str]


class CountResponse(BaseModel):
    session_id: str
    mantra_id: str
    count: int
    target_count: int
    remaining: int
    mala_complete: bool
    last_verified_at: Optional[str]


class ChatRequest(BaseModel):
    session_id: str
    message: str
    language: str = "hi"


class ChatResponse(BaseModel):
    reply: str
    language: str


class SpeakRequest(BaseModel):
    text: str


async def transcribe_audio(
    audio_bytes: bytes, filename: str, content_type: str, language: str
) -> str:
    """Send audio to OpenRouter for transcription and return the transcript text.

    Raises HTTPException with a client-appropriate status code on any failure
    (missing API key, upstream auth/rate-limit/server errors, timeouts).
    """
    api_key = require_api_key()

    files = {"file": (filename, audio_bytes, content_type or "application/octet-stream")}
    data = {"model": TRANSCRIPTION_MODEL, "language": language}

    response = await openrouter_post(OPENROUTER_TRANSCRIPTION_URL, api_key, data=data, files=files)

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
    language: str = Form(TRANSCRIPTION_LANGUAGE),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    transcript = await transcribe_audio(
        audio_bytes, audio.filename or "audio.wav", audio.content_type, language
    )

    score = score_match(reference_text, transcript)
    passed = score >= PASS_THRESHOLD
    diff = word_diff(reference_text, transcript)
    stats = completion_stats(diff)

    if passed:
        count, last_verified_at = counter.increment(session_id, mantra_id)
    else:
        count, last_verified_at = counter.get_count(session_id, mantra_id)

    history.log_verification(
        session_id=session_id,
        mantra_id=mantra_id,
        score=score,
        passed=passed,
        completion_ratio=stats["completion_ratio"],
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    remaining = max(target_count - count, 0)

    return VerifyResponse(
        score=score,
        completion_ratio=stats["completion_ratio"],
        passed=passed,
        count=count,
        target_count=target_count,
        remaining=remaining,
        mala_complete=count >= target_count,
        transcript=transcript,
        reference_normalized=normalize_text(reference_text),
        spoken_normalized=normalize_text(transcript),
        word_diff=diff,
        words_matched=stats["words_matched"],
        words_expected=stats["words_expected"],
        last_verified_at=last_verified_at,
    )


@app.post("/verify_batch", response_model=VerifyBatchResponse)
async def verify_batch(
    audio: UploadFile = File(...),
    reference_text: str = Form(...),
    session_id: str = Form(...),
    mantra_id: str = Form(...),
    target_count: int = Form(108),
    language: str = Form(TRANSCRIPTION_LANGUAGE),
):
    """Verify one recording that covers several repetitions of the mantra
    back-to-back, rather than one recording per repetition. Detects how many
    times the mantra was recited and adds all of them to the counter at once.
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    transcript = await transcribe_audio(
        audio_bytes, audio.filename or "audio.wav", audio.content_type, language
    )

    result = count_repetitions(reference_text, transcript)
    detected = result["repetitions"]

    count, last_verified_at = counter.increment_by(session_id, mantra_id, detected)

    average_score = (
        sum(segment["score"] for segment in result["segments"]) / detected if detected else 0.0
    )
    history.log_verification(
        session_id=session_id,
        mantra_id=mantra_id,
        score=average_score,
        passed=detected > 0,
        completion_ratio=min(detected / target_count, 1.0) if target_count else 0.0,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    remaining = max(target_count - count, 0)

    return VerifyBatchResponse(
        detected_repetitions=detected,
        count=count,
        target_count=target_count,
        remaining=remaining,
        mala_complete=count >= target_count,
        transcript=transcript,
        reference_normalized=normalize_text(reference_text),
        segments=result["segments"],
        last_verified_at=last_verified_at,
    )


@app.post("/verify_chant", response_model=VerifyChantResponse)
async def verify_chant(
    audio: UploadFile = File(...),
    reference_text: str = Form(...),
    session_id: str = Form(...),
    mantra_id: str = Form(...),
    target_count: int = Form(108),
    language: str = Form(TRANSCRIPTION_LANGUAGE),
):
    """Judge one short utterance from a continuous, VAD-segmented chanting
    session (see static/app.js's Live Chanting Session). Fuzzy match handles
    clear passes/fails immediately; only borderline scores
    (matcher.AI_REVIEW_LOWER_BOUND to matcher.PASS_THRESHOLD) call the AI
    judge, so a long session doesn't make an LLM call for every utterance.

    Empty transcripts (silence/noise that clipped past the frontend's own
    minimum-duration filter) are treated as an ordinary not-counted result,
    not an error — that's an expected, frequent occurrence in a continuous
    listening session, unlike a fully-formed manual /verify recording.
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    try:
        transcript = await transcribe_audio(
            audio_bytes, audio.filename or "audio.wav", audio.content_type, language
        )
    except HTTPException as exc:
        if exc.status_code == 422:
            transcript = ""
        else:
            raise

    if not transcript:
        counted = False
        decision_source = "empty_transcript"
        score = 0.0
    else:
        score = score_match(reference_text, transcript)
        if score >= PASS_THRESHOLD:
            counted, decision_source = True, "fuzzy_pass"
        elif score < AI_REVIEW_LOWER_BOUND:
            counted, decision_source = False, "fuzzy_fail"
        else:
            verdict = await vyas.judge_chant(reference_text, transcript)
            counted, decision_source = verdict["counted"], "ai_judged"

    if counted:
        count, last_verified_at = counter.increment(session_id, mantra_id)
    else:
        count, last_verified_at = counter.get_count(session_id, mantra_id)

    history.log_verification(
        session_id=session_id,
        mantra_id=mantra_id,
        score=score,
        passed=counted,
        completion_ratio=1.0 if counted else 0.0,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    remaining = max(target_count - count, 0)

    return VerifyChantResponse(
        counted=counted,
        decision_source=decision_source,
        score=score,
        transcript=transcript,
        count=count,
        target_count=target_count,
        remaining=remaining,
        mala_complete=count >= target_count,
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


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    if request.language not in vyas.LANGUAGE_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{request.language}'. Supported: {sorted(vyas.LANGUAGE_NAMES)}",
        )

    recent_history = history.get_recent(request.session_id)
    reply = await vyas.generate_reply(request.message, recent_history, request.language)
    return ChatResponse(reply=reply, language=request.language)


@app.post("/speak")
async def speak(request: SpeakRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    audio_bytes = await vyas.synthesize_speech(request.text)
    return Response(content=audio_bytes, media_type="audio/wav")


# Registered last so the API routes above always match first — this mount's
# prefix ("/") would otherwise catch every request before they're reached.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
