# mantra_verify

FastAPI backend + static frontend for verifying a spoken Hindu mantra against
a Devanagari reference text, with **Vyas** — a conversational sage character
who talks through your practice. Transcription, conversation, and voice
synthesis all run on OpenRouter's cloud APIs (`openai/whisper-large-v3` for
speech-to-text, a chat model for Vyas's replies, and a TTS model for his
voice); text matching is local (rapidfuzz). Tracks verified repetition counts
per session toward a target (e.g. 108 for a mala), and logs session history
so Vyas can talk about your actual practice.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# then edit .env and set OPENROUTER_API_KEY to a real key from openrouter.ai/keys
```

`main.py` calls `load_dotenv()` on startup, so anything in `.env` is loaded
into the environment automatically — no need to `export` it in your shell.
`OPENROUTER_API_KEY` is then read at request time (not at import time), so
the server starts fine even without a key set — only `POST /verify` will
fail, with a clear 500, until `.env` has a real key in it.

## Run

```bash
uvicorn main:app --reload
```

Open http://127.0.0.1:8000/ for the frontend — Vyas's character, the mantra
recorder, and the chat box. It's a static page (`static/index.html` +
`style.css` + `app.js`) served directly by FastAPI, same origin as the API,
so there's no CORS setup to worry about.

## API

### `GET /health`

Returns `{"status": "ok"}`. No API key required.

### `POST /verify`

Multipart form:

| field | type | required | description |
|---|---|---|---|
| `audio` | file | yes | Audio recording of the spoken mantra |
| `reference_text` | string | yes | Reference mantra text (Devanagari) |
| `session_id` | string | yes | Client-generated session identifier |
| `mantra_id` | string | yes | Identifier for the mantra being chanted |
| `target_count` | int | no (default `108`) | Repetitions target for `mala_complete` |
| `language` | string | no (default `hi`) | Whisper language hint — see `vyas.LANGUAGE_NAMES` for the full supported set |

```bash
curl -X POST http://127.0.0.1:8000/verify \
  -F "audio=@/path/to/your/recording.wav" \
  -F "reference_text=ॐ नमः शिवाय" \
  -F "session_id=demo-session-1" \
  -F "mantra_id=om-namah-shivaya" \
  -F "target_count=108" \
  -F "language=hi"
```

Every `/verify` call (pass or fail) is also logged to `data/history.json` via
`history.py`, so Vyas's chat replies can reference real past attempts —
score, pass/fail, completion ratio, and timestamp — not just the current one.

Response fields are ordered `score`, `completion_ratio`, `passed`, `count`,
`target_count`, `remaining`, `mala_complete` first — those are what a client
reacts to immediately — followed by `transcript`, `reference_normalized`,
`spoken_normalized`, `word_diff`, `words_matched`, `words_expected`,
`last_verified_at`.

`word_diff` is an ordered list of `[word, tag]` pairs (`tag` is `"match"`,
`"missing"`, or `"extra"`) computed with `difflib.SequenceMatcher` over the
normalized word sequences, so it reflects word position, not just set
differences.

`completion_ratio` (`words_matched / words_expected`) is a separate signal
from `score`: it tells you what fraction of the reference mantra's words
showed up in the transcript at all, regardless of pronunciation accuracy or
word order elsewhere. It's normalized to 0.0–1.0 so it means the same thing
for a 3-word mantra as a 30-word one — use it to detect "gave up partway
through" as distinct from "recited it all but got some words wrong," which
`score` alone conflates into a single number. Extra spoken words (filler,
false starts) never count against it — `words_expected` only counts
reference words. There's no fixed "completion passed" threshold on purpose:
the same ratio drop (e.g. missing one word) means something very different
for a short mantra than a long one, so pick a per-`mantra_id` bar if you need
one, the same way `PASS_THRESHOLD` may eventually need to vary by mantra
(see below).

A verification only increments `count` when `score >= 82.0`
(`matcher.PASS_THRESHOLD`) — `completion_ratio` does not currently affect
`passed` or the counter, it's informational only.

**Error responses** — `/verify` returns clear errors instead of crashing:
- `400` — empty/missing audio file
- `422` — transcription came back empty (e.g. silence, noise)
- `429` — OpenRouter rate limit hit
- `502` — OpenRouter rejected the key, or returned any other upstream error
- `504` — transcription request timed out
- `500` — `OPENROUTER_API_KEY` not configured on the server

### `GET /count/{session_id}?mantra_id=...&target_count=108`

Returns the current count, remaining, and mala-complete status for one
session+mantra pair.

### `POST /count/{session_id}/reset?mantra_id=...`

Resets the count (and `last_verified_at`) for one mantra under that session
back to zero/`null`.

### `POST /chat`

JSON body: `{"session_id": "...", "message": "...", "language": "hi"}`.

Sends the message to a chat model (`vyas.CHAT_MODEL`, `openai/gpt-4o-mini` by
default — a different model from Whisper, since transcription and
conversation are different tasks) via OpenRouter, with a system prompt that
establishes Vyas's persona and includes a summary of the last 5 `/verify`
attempts logged for that `session_id` from `history.py`. Returns
`{"reply": "...", "language": "hi"}`. `language` must be one of the codes in
`vyas.LANGUAGE_NAMES` (the same Devanagari-adjacent language set `/verify`
transcribes) — a 400 otherwise.

### `POST /speak`

JSON body: `{"text": "..."}`. Sends the text to OpenRouter's TTS endpoint
(`vyas.TTS_MODEL`) and returns raw `audio/mpeg` bytes (not JSON) — the
frontend plays this directly. `/chat` and `/speak` are deliberately separate
calls rather than one combined endpoint, so the frontend can show Vyas's text
reply immediately without waiting on speech synthesis, and so a TTS failure
doesn't take down the whole conversation.

**Error responses on `/chat` and `/speak`** follow the same convention as
`/verify`: `429` (rate limit), `502` (key rejected or other OpenRouter
error), `504` (timeout), `500` (`OPENROUTER_API_KEY` not set). This mapping
lives in `openrouter_client.py`, shared by all three OpenRouter call sites
(`/verify`, `/chat`, `/speak`) instead of being duplicated per endpoint.

## Vyas's portrait

The character illustration in `static/index.html` is a hand-built SVG
placeholder — recognizable (white hair/beard, tripundra, saffron robe,
raised mudra, banyan roots) but stylized, not photorealistic.
`scripts/generate_vyas_portrait.py` generates a real image via OpenRouter's
image API (`POST /api/v1/images`) once a real `OPENROUTER_API_KEY` is in
`.env`:

```bash
source venv/bin/activate
python scripts/generate_vyas_portrait.py
```

Saves to `static/vyas-portrait.png`. Edit the `PROMPT` or `IMAGE_MODEL`
constant in that script and re-run to iterate.

## Notes on transcription language

Whisper actually does have a dedicated Sanskrit code (`sa`) — despite what
you may read elsewhere (including earlier notes in this project). It's just
a much lower-resource language in Whisper's training data than Hindi, so
`language="hi"` is the default here as a likely-more-accurate stand-in for
Devanagari mantra chanting, not because `sa` doesn't exist. Pass a different
`language` value per-request (on `/verify`) to compare the two yourself —
see `vyas.LANGUAGE_NAMES` for the full set this app recognizes.

## Notes on text normalization

`matcher.normalize_text` collapses Devanagari quirks that are ASR artifacts
rather than real mismatches, before scoring or diffing: avagraha (ऽ) and
nukta (़) are stripped, chandrabindu (ँ) is folded into anusvara (ं), and both
ASCII and Devanagari punctuation (। ॥) are removed. See the comments in
`matcher.py` for the reasoning behind each.

## Tuning the pass threshold

`PASS_THRESHOLD = 82.0` in `matcher.py` is a starting point, not a measured
value. Once you have real recordings:

1. Collect a batch of clips you'd call "clearly correct" and a batch you'd
   call "clearly wrong" (mispronounced, wrong mantra, garbled).
2. Run them through `/verify` (or call `score_match` directly in a script)
   and log the scores.
3. Look at the gap between your "correct" cluster's minimum and your "wrong"
   cluster's maximum. If they overlap, `token_sort_ratio` isn't separating
   them cleanly for your mantra length/vocabulary — consider a different
   rapidfuzz scorer (e.g. `token_set_ratio` if extra filler words are common)
   before just sliding the threshold.
4. Set `PASS_THRESHOLD` just above the "wrong" cluster's max, not exactly
   between the two clusters — false passes (incrementing a mala on a wrong
   recitation) are usually worse for this use case than false rejects
   (asking someone to repeat a mantra they got right).
5. Re-tune per mantra length: very short mantras have less text for
   `token_sort_ratio` to work with, so a single wrong syllable moves the
   score much more than in a long mantra — you may eventually want
   `PASS_THRESHOLD` to vary by `mantra_id` rather than being global.

## Tests

```bash
pytest
```

Covers `matcher.py`'s normalization, scoring, and word-diff logic. There's no
mock-OpenRouter test for `main.py` yet — worth adding if this goes further.
