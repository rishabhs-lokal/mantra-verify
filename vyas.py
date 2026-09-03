"""Vyas: a conversational sage persona that guides mantra practice.

Chat replies and voice synthesis both go through OpenRouter, reusing the
same OPENROUTER_API_KEY as transcription — no separate account/key needed
for either. Chat uses OpenRouter's chat-completions endpoint (a text model,
distinct from Whisper); voice uses OpenRouter's /audio/speech endpoint.

OpenAI does not currently offer a TTS model through OpenRouter's speech
endpoint (verified against the live `/api/v1/models?output_modalities=speech`
catalog — OpenRouter's own docs reference an OpenAI TTS model id that
doesn't actually exist there). Using Gemini's TTS instead, which does.
"""

import io
import wave

from openrouter_client import post as openrouter_post
from openrouter_client import require_api_key

OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech"

CHAT_MODEL = "openai/gpt-4o-mini"
TTS_MODEL = "google/gemini-3.1-flash-tts-preview"
TTS_VOICE = "Charon"

# Gemini's TTS only outputs raw PCM (no mp3/wav option) at a fixed rate this
# app doesn't control — confirmed via the endpoint's own response headers,
# not documented anywhere. synthesize_speech() wraps it in a WAV header
# using these values so browsers can play it without a decoder.
TTS_SAMPLE_RATE_HZ = 24000
TTS_SAMPLE_WIDTH_BYTES = 2  # 16-bit signed PCM
TTS_CHANNELS = 1

# Languages Whisper (and therefore this app's /verify) can transcribe for
# Devanagari-adjacent mantra practice — Vyas is limited to the same set so
# the character never promises a language the rest of the app can't verify.
LANGUAGE_NAMES = {
    "hi": "Hindi",
    "en": "English",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi",
    "ur": "Urdu",
    "ne": "Nepali",
    "sa": "Sanskrit",
    "as": "Assamese",
    "sd": "Sindhi",
}

SYSTEM_PROMPT_TEMPLATE = """You are Vyas, a wise, warm, and serene sage who guides people through their \
mantra japa (repetition) practice. Speak the way a kind guru would: calm, \
encouraging, unhurried — never robotic, clinical, or overly formal. You know \
about Hindu mantras, japa/mala practice, and the significance of counts like \
108, but you are not a substitute for a real teacher and never give medical, \
legal, or financial advice.

Respond ONLY in {language_name}, regardless of what language the user writes \
in.

Keep replies short — 2 to 4 sentences. This is a spoken conversation, not an \
essay.

What you know about this person's practice so far:
{context_summary}
"""


def _build_context_summary(history: list) -> str:
    if not history:
        return "They haven't recorded any verified recitations yet in this session."

    lines = []
    for entry in history:
        status = "passed" if entry["passed"] else "did not pass"
        lines.append(
            f"- {entry['mantra_id']}: score {entry['score']:.0f}/100, {status}, "
            f"{entry['completion_ratio']:.0%} of the mantra completed, at {entry['timestamp']}"
        )
    return "\n".join(lines)


async def generate_reply(message: str, history: list, language: str) -> str:
    """Ask the chat model for Vyas's reply, grounded in this session's recent history."""
    api_key = require_api_key()
    language_name = LANGUAGE_NAMES.get(language, "English")

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        language_name=language_name,
        context_summary=_build_context_summary(history),
    )

    payload = {
        "model": CHAT_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ],
    }

    response = await openrouter_post(
        OPENROUTER_CHAT_URL,
        api_key,
        json=payload,
        headers={"Content-Type": "application/json"},
    )
    data = response.json()
    return data["choices"][0]["message"]["content"].strip()


async def synthesize_speech(text: str) -> bytes:
    """Turn text into spoken audio (WAV bytes) via OpenRouter's TTS endpoint."""
    api_key = require_api_key()

    payload = {
        "model": TTS_MODEL,
        "input": text,
        "voice": TTS_VOICE,
        "response_format": "pcm",
    }

    response = await openrouter_post(
        OPENROUTER_SPEECH_URL,
        api_key,
        json=payload,
        headers={"Content-Type": "application/json"},
    )
    return _pcm_to_wav(response.content)


def _pcm_to_wav(pcm_bytes: bytes) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(TTS_CHANNELS)
        wav_file.setsampwidth(TTS_SAMPLE_WIDTH_BYTES)
        wav_file.setframerate(TTS_SAMPLE_RATE_HZ)
        wav_file.writeframes(pcm_bytes)
    return buffer.getvalue()
