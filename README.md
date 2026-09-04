# mantra_verify

FastAPI backend + static frontend for verifying a spoken Hindu mantra against
a Devanagari reference text, with **Vyas** — a sage character who leads or
listens to your practice. Transcription, conversation, and voice synthesis
all run on OpenRouter's cloud APIs (Whisper for speech-to-text, a chat model
for Vyas's replies, a TTS model for his voice); text matching is local
(rapidfuzz). Tracks verified repetition counts per session, logs session
history so Vyas can talk about your actual practice, and generates Vyas's
portrait via an image-generation API.

The frontend is deliberately minimal: Vyas's portrait and a counter card are
the only two things on screen. You pick "You Chant" (mic listens
continuously, verifies each repetition) or "Vyas Chants" (he leads, no
verification), a count from 1–12, and press Start.

## This is a module, not a standalone app

`vyas/` is a proper, pip-installable Python package
(`pyproject.toml`) exposing one thing: `router`, a FastAPI `APIRouter`.
`main.py` at the repo root is **not** the module — it's a thin demo launcher
that mounts `vyas.router` onto its own `FastAPI()` instance and serves the
`static/` frontend, so the package can be run and tested standalone without
a parent app.

The actual integration target is **Ved** (`ved-main 2/`, a separate
React + FastAPI app one directory over) — this package is meant to be
mounted into `ved-main 2/backend/main.py`:

```python
from vyas import router as vyas_router
app.include_router(vyas_router, prefix="/api/vyas")
```

This is already wired up and verified working — `ved-main 2/backend/main.py`
includes it, and `ved-main 2/backend/requirements.txt` installs `vyas` via
`-e ../..` (editable, pointing at this repo's root where `pyproject.toml`
lives). Confirmed live: booting `uvicorn backend.main:app` from inside
`ved-main 2/` correctly exposes every Vyas endpoint under `/api/vyas/*`
alongside Ved's own existing `/api/session/*` routes, no conflicts.

**Important**: `vyas` never calls `load_dotenv()` itself — only the
standalone demo's `main.py` does, since it's the actual process entry
point. When mounted into Ved's backend (or any other parent app),
`OPENROUTER_API_KEY` must be set by *that* app's own environment setup —
confirmed this fails cleanly (500, clear message, not a crash) if it
isn't, rather than silently doing nothing.

**What's mounted vs. what isn't**: the FastAPI routes (`vyas.router`) are a
real, tested integration. The `static/` frontend (portrait, counter card,
mode toggle, VAD listening) is the standalone demo's UI, not Ved's actual
UI — Ved's own React frontend (`ved-main 2/src/`) still has its own
`MantraRoom` component with a manual tap-to-count button, which does not
yet call any Vyas endpoint. Wiring Ved's React UI to actually use
`/api/vyas/verify_chant` etc. (replacing or augmenting the tap button with
real voice verification) is the natural next step, not done here.

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

Open http://127.0.0.1:8000/ for the frontend. It's a static page
(`static/index.html` + `style.css` + `app.js`) served directly by FastAPI,
same origin as the API, so there's no CORS setup to worry about.

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
| `language` | string | no (default `hi`) | Whisper language hint — see `vyas.persona.LANGUAGE_NAMES` for the full supported set |

```bash
curl -X POST http://127.0.0.1:8000/verify \
  -F "audio=@/path/to/your/recording.wav" \
  -F "reference_text=ॐ नमः शिवाय" \
  -F "session_id=demo-session-1" \
  -F "mantra_id=om-namah-shivaya" \
  -F "target_count=108" \
  -F "language=hi"
```

Every `/verify` call (pass or fail) is also logged to `vyas/data/history.json` via
`vyas/history.py`, so Vyas's chat replies can reference real past attempts —
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
(`vyas.matcher.PASS_THRESHOLD`) — `completion_ratio` does not currently affect
`passed` or the counter, it's informational only.

**Error responses** — `/verify` returns clear errors instead of crashing:
- `400` — empty/missing audio file
- `422` — transcription came back empty (e.g. silence, noise)
- `429` — OpenRouter rate limit hit
- `502` — OpenRouter rejected the key, or returned any other upstream error
- `504` — transcription request timed out
- `500` — `OPENROUTER_API_KEY` not configured on the server

### `POST /verify_batch`

Same form fields as `/verify`. Use this when one recording covers several
repetitions of the mantra back-to-back (e.g. "say it 11 times, then stop"),
instead of one recording per repetition.

`vyas.matcher.count_repetitions()` finds how many times the mantra appears in the
transcript using a **character-level** sliding window (not word-level) —
live testing found Whisper fuses words together with no spaces at all on
rapid, monotonous repeated speech (`"ओम्नमहशिवाय"` instead of
`"ओम् नमः शिवाय"`), which breaks a word-count window completely. All
detected repetitions are added to the counter in one call via
`vyas.counter.increment_by()`.

Response adds `detected_repetitions` and `segments` (each with `text` and
`score`) in place of `/verify`'s `score`/`passed`/`word_diff`/etc. — same
`count`/`target_count`/`remaining`/`mala_complete`/`transcript`/
`reference_normalized`/`last_verified_at` fields otherwise.

**Known limitation**: perfectly uniform, pause-free audio (e.g. robotic
TTS) can trigger Whisper's repetition-collapse behavior and truncate well
before the actual end of a long repeated clip — confirmed with an
11-repetition synthetic test that only transcribed ~4. Natural human
pauses/variation between repetitions should avoid this, but it's a real
Whisper quirk, not something this app's code can fix.

### `POST /verify_chant`

Same form fields as `/verify`. This is the single-utterance endpoint behind
the **Live Chanting Session** UI — one recording per detected utterance from
continuous listening, which could be one repetition or several fused
together if you're chanting quickly.

Transcribes with `LIVE_TRANSCRIPTION_MODEL`
(`openai/whisper-large-v3-turbo`) rather than the standard
`TRANSCRIPTION_MODEL` used by `/verify`/`/verify_batch`, in response to
feedback that verification felt slow.

**Measured honestly, not assumed**: 3 timed runs of each model on the same
clip put turbo at ~2.7s average vs. standard at ~3.5s — a real but modest
~20% gain, with high variance (one turbo run took 4.2s, another 1.1s), and
turbo's transcription was measurably less accurate ("नमह"/"शिवाए" vs. the
standard model's "नमः"/"शिवाई" on identical audio). A less accurate
transcription can also land in the AI-review gray zone more often, adding
an extra chat-model call that eats into or reverses the time saved — this
happened during testing. Net: still worth keeping since it's rarely worse
and this endpoint's matching already tolerates the accuracy hit, but **it
does not make verification fast** — 2-4 seconds appears to be roughly the
floor for a cloud Whisper round-trip regardless of model choice. If
sub-second response time is actually required, the real fix is running
Whisper locally instead of round-tripping to OpenRouter per utterance —
a bigger change (accuracy tradeoff, more setup) not implemented here.

Two-stage decision, and deliberately makes exactly **one** network call
(transcription) — no more:

1. **Repetition detection first** — `count_repetitions()` (the same
   character-level matcher `/verify_batch` uses) checks whether the
   utterance actually contains one or more back-to-back repetitions of the
   mantra, using `LIVE_CHANT_THRESHOLD` (55.0 — the most lenient threshold
   in the app). If it finds N ≥ 1, all N are counted at once —
   `decision_source: "matched"`, `repetitions_counted: N`. This is what
   makes chanting speed a non-issue: however many repetitions the
   silence-gap detector failed to split into separate utterances, this
   still finds and counts correctly.
2. **Only if that finds nothing** does it fall back to a single
   whole-utterance comparison against the same `LIVE_CHANT_THRESHOLD` —
   `decision_source: "fuzzy_pass"` if it clears the bar, `"fuzzy_fail"`
   otherwise.

An earlier version added an AI-judge chat-completion call for borderline
scores instead of step 2's fixed threshold. Removed: it meant unpredictable
extra latency on exactly the utterances that triggered it, and in a
real-time continuous-listening loop consistent speed matters more than the
small amount of extra leniency that call bought. `vyas.judge_chant()` and
the code behind it were deleted, not just disconnected, once nothing called
it anymore.

An empty transcript (silence, or noise that slipped past the frontend's
minimum-utterance-duration filter) is `decision_source: "empty_transcript"`,
`counted: false` — treated as a normal, expected outcome in continuous
listening, not an error, unlike `/verify`'s 422 on the same condition.

Response: `{counted, repetitions_counted, decision_source, score, transcript, count, target_count, remaining, mala_complete, last_verified_at}`.
`repetitions_counted` (not just `counted`) is what gets added to the
persistent session+mantra counter via `vyas.counter.increment_by()`.

Transcribes with `LIVE_TRANSCRIPTION_MODEL`
(`openai/whisper-large-v3-turbo`) rather than the standard
`TRANSCRIPTION_MODEL` used by `/verify`/`/verify_batch`, in response to
feedback that verification felt slow. **Measured honestly, not assumed**: 3
timed runs of each model on the same clip put turbo at ~2.7s average vs.
standard at ~3.5s — a real but modest ~20% gain, with high variance (one
turbo run took 4.2s, another 1.1s), and turbo's transcription was measurably
less accurate on identical audio. Kept anyway since `LIVE_CHANT_THRESHOLD`
already tolerates the accuracy hit, but **this does not make verification
fast** — 2-4 seconds appears to be roughly the floor for a cloud Whisper
round-trip regardless of model choice. If sub-second response time is
actually required, the real fix is running Whisper locally instead of
round-tripping to OpenRouter per utterance — a bigger change not
implemented here.

**Known limitation — no idempotency**: if the server successfully processes
a chant (transcribe + increment) but the HTTP response is lost in transit (a
real occurrence seen during testing — a flaky connection dropped the
response after the server had already incremented the counter), the client
has no way to know the call actually succeeded. A naive retry would
double-count. The frontend does not currently retry failed `/verify_chant`
calls automatically, which avoids the common case, but there's no
request-level deduplication (e.g. an idempotency key) if a retry does
happen some other way.

### `GET /count/{session_id}?mantra_id=...&target_count=108`

Returns the current count, remaining, and mala-complete status for one
session+mantra pair.

### `POST /count/{session_id}/reset?mantra_id=...`

Resets the count (and `last_verified_at`) for one mantra under that session
back to zero/`null`.

### `POST /count/{session_id}/increment?mantra_id=...&target_count=108`

Increments the counter directly — no audio, no transcription, no analysis.
Powers the Live Chanting Session's grace-period chants (see below), which
are assumed correct rather than verified; also usable anywhere else a caller
wants to advance the count without a `/verify_chant` round trip. Same
response shape as `GET /count/{session_id}`.

### `POST /chat`

No frontend UI calls this anymore (the chat box was removed along with
Settings when the UI was simplified to just the portrait + counter card),
but the endpoint itself is untouched and still fully functional — useful
for testing directly, or if a chat surface comes back later.

JSON body: `{"session_id": "...", "message": "...", "language": "hi"}`.

Sends the message to a chat model (`vyas.persona.CHAT_MODEL`, `openai/gpt-4o-mini` by
default — a different model from Whisper, since transcription and
conversation are different tasks) via OpenRouter, with a system prompt that
establishes Vyas's persona and includes a summary of the last 5 `/verify`
attempts logged for that `session_id` from `vyas/history.py`. Returns
`{"reply": "...", "language": "hi"}`. `language` must be one of the codes in
`vyas.persona.LANGUAGE_NAMES` (the same Devanagari-adjacent language set `/verify`
transcribes) — a 400 otherwise.

### `POST /speak`

JSON body: `{"text": "..."}`. Sends the text to OpenRouter's TTS endpoint
(`vyas.persona.TTS_MODEL`, `google/gemini-3.1-flash-tts-preview`) and returns
`audio/wav` bytes (not JSON) — the frontend plays this directly. `/chat` and
`/speak` are deliberately separate calls rather than one combined endpoint,
so the frontend can show Vyas's text reply immediately without waiting on
speech synthesis, and so a TTS failure doesn't take down the whole
conversation.

Note: OpenRouter's own docs reference an OpenAI TTS model
(`openai/gpt-4o-mini-tts-...`) that does not actually exist on the platform —
confirmed by querying the live `/api/v1/models?output_modalities=speech`
catalog, which has no OpenAI entries at all. Gemini's TTS is used instead.
It only outputs raw PCM (no mp3/wav option), so `vyas.persona.synthesize_speech`
wraps it in a WAV header (`vyas.persona._pcm_to_wav`) before returning it — a plain
`<audio>` tag can't play headerless PCM directly.

**Error responses on `/chat` and `/speak`** follow the same convention as
`/verify`: `429` (rate limit), `502` (key rejected or other OpenRouter
error), `504` (timeout), `500` (`OPENROUTER_API_KEY` not set). This mapping
lives in `vyas/openrouter_client.py`, shared by all three OpenRouter call sites
(`/verify`, `/chat`, `/speak`) instead of being duplicated per endpoint.

## Vyas's portrait

`static/vyas-portrait.png` is generated via OpenRouter's image API
(`POST /api/v1/images`, `black-forest-labs/flux.2-pro`) by
`scripts/generate_vyas_portrait.py`:

```bash
source venv/bin/activate
python scripts/generate_vyas_portrait.py
```

This overwrites `static/vyas-portrait.png` — edit the `PROMPT` or
`IMAGE_MODEL` constant in that script and re-run to get a different result.
An earlier hand-built SVG placeholder lived directly in `index.html` before
this; it's gone now that a real portrait exists, but the git history has it
if you ever want to compare.

## The frontend (static/app.js)

The whole UI is one card: a mode toggle (**You Chant** / **Vyas Chants**), a
chant count (1–12, `MAX_CHANTS_PER_SESSION`), Start/Stop/Resume, and a
countdown display. No mantra text box, language selector, or chat UI —
those existed in earlier iterations and were removed to keep the screen to
just Vyas's portrait and this card. The mantra, mantra id, and language are
now hardcoded constants at the top of `app.js`
(`REFERENCE_TEXT`/`MANTRA_ID`/`LANGUAGE`) — change them there if you need a
different mantra; there's currently no UI for switching at runtime.

**This hardcoding is a demo-frontend limitation, not a module limitation.**
`vyas.router`'s endpoints (`/verify`, `/verify_chant`, `/verify_batch`) all
take `reference_text`/`mantra_id`/`language` as per-request form fields —
the backend is already mantra-agnostic. Ved needs this: `ved-main 2/src/data.ts`
defines 4 mantras (Om Namah Shivaya, Om Shri Hanumate Namah, Jai Shri Ram,
Jai Maa Durga), not the one this demo hardcodes. A real integration into
Ved's React UI would pass whichever mantra the user picked from that list
as `reference_text`/`mantra_id` in each request — no backend changes
needed, just a frontend that doesn't hardcode a single mantra like this
demo's `app.js` does.

### Vyas Chants mode

No listening, no verification — `counting logic shuts` entirely, per the
product decision behind this mode. `startVyasChantingMode()` loops
`playVyasChantOnce()` the selected number of times, counting down a purely
local display counter (no backend calls at all — this mode doesn't touch
the persisted session+mantra counter, since nothing is actually being
verified).

`playVyasChantOnce()` checks `VYAS_CHANT_VIDEO_SRC` first — **currently
`null`, a placeholder** pending the real video asset. Until that's set,
every "play" falls back to `speakAsVyas(REFERENCE_TEXT)` (the existing TTS
pipeline), so the mode is fully testable without the video. Once you have
the file, set `VYAS_CHANT_VIDEO_SRC` to its path (e.g. `"/vyas-chant.mp4"`)
and it switches over automatically — same loop, same counter logic, no
other changes needed.

### You Chant mode

Continuous mic listening: start it once, then chant — each recognized
chant automatically counts down, no manual start/stop per repetition.

There is no streaming transcription (OpenRouter's Whisper endpoint is
one-shot request/response), so this segments your speech into individual
utterances itself, client-side, using simple volume-based voice activity
detection (VAD) — not a proper VAD library, just an RMS-over-threshold check
via the Web Audio API (`AnalyserNode`). When volume crosses
`SESSION_SPEECH_RMS_THRESHOLD` it starts recording; after
`SESSION_UTTERANCE_SILENCE_GAP_MS` (500ms) of continuous silence it stops,
finalizes that utterance's clip, and sends it to `/verify_chant`.
Utterances shorter than `SESSION_MIN_UTTERANCE_MS` are discarded
client-side without even calling the server (almost certainly noise, not a
real chant). **These thresholds are untested against real microphone
hardware/environments** — a reasonable starting point, not calibrated
values; if chanting speed or background noise causes problems, these are
the first constants to adjust (top of the "User Chants mode" section in
`app.js`).

**First `FREE_CHANTS_AT_START` chants (3) are assumed correct, not
verified.** Each detected utterance during this grace period calls
`countFreeChant()`, which hits `POST /count/{id}/increment` directly — no
audio upload, no transcription, effectively instant. This is a deliberate
product decision (not a bug or a shortcut): the session doesn't start by
second-guessing you before you've settled into a rhythm. The server
(`data.remaining` from the increment response) stays the single source of
truth for the displayed count throughout, so there's no risk of the display
jumping or desyncing once real analysis (`submitChant()`) takes over from
chant 4 onward.

**Non-visual feedback**: `playCountedTone()`/`playNotCountedTone()` play a
short synthesized chime (Web Audio API `OscillatorNode`, no TTS round-trip)
on every chant result — bright/short for counted, quiet/dull for not
counted. Added because you're not going to be reading on-screen text while
chanting with your eyes closed; the tones give the same information without
requiring that.

**Silence timer** — only *counted* chants reset it, not just any detected
speech: `SESSION_PAUSE_MS` (10s) since the last counted chant and the
session pauses entirely (stops listening) until you click **Resume** — no
spoken prompt, just the pause.

**Consecutive-error handling**: `SESSION_ERROR_STREAK_LIMIT` (3) tracks
not-counted attempts in a row, independent of the silence timer above — a
chanting *fast* isn't the same as chanting *wrong*. On the 3rd consecutive
rejection, Vyas re-speaks the mantra as corrective pronunciation guidance,
then the session pauses exactly like the silence-timeout case — explicit
Resume required, consecutive-error count reset to 0.

**Barge-in**: while Vyas is speaking during an active session (the 3-error
mantra re-teaching), `session.vyasSpeaking` is set — but `pollSession()`
doesn't fully stop, it switches to a lightweight mode that only watches for
sound and immediately calls `vyasAudio.pause()` the instant any is
detected, cutting him off rather than making you wait for him to finish.
This is also what prevents his own voice from leaking through your
speakers into the mic and registering as a false chant (the same guard
serves both purposes) — `speakAsVyas()` was changed from resolving when
playback *starts* to resolving when it *ends* specifically to make this
sequencing work, since callers need to know when he's actually done (or
interrupted) talking, not just when he started.

**Reassurance is spoken in Hindi**: `COMPLETION_PLACEHOLDER_TEXT` is Hindi
regardless of anything else — it's Vyas's own reassurance, not mantra
content. It's also a **placeholder** — swap it for the real line whenever
you have it; it's a single string constant, clearly marked, spoken by both
modes when the counter hits zero.

**Counter always starts fresh**: `startChantingSession()` calls
`POST /count/{session_id}/reset` before beginning, so every session starts
its countdown at exactly the number you set — it does not resume progress
from a previous session on the same mantra.

**Known limitation — no request idempotency**: see `/verify_chant`'s README
section above. In rare cases of connection flakiness, a chant could
theoretically be counted twice if the server succeeds but the response is
lost and something retries.

## Notes on transcription language

Whisper actually does have a dedicated Sanskrit code (`sa`) — despite what
you may read elsewhere (including earlier notes in this project). It's just
a much lower-resource language in Whisper's training data than Hindi, so
`language="hi"` is the default here as a likely-more-accurate stand-in for
Devanagari mantra chanting, not because `sa` doesn't exist. Pass a different
`language` value per-request (on `/verify`) to compare the two yourself —
see `vyas.persona.LANGUAGE_NAMES` for the full set this app recognizes.

**Known gap, found via live testing**: Whisper often transcribes the ॐ
symbol (U+0950) as the phonetically-spelled-out ओम (two characters) instead
of the symbol itself. `normalize_text` doesn't currently treat these as
equivalent, so a mantra starting with ॐ can score lower than it should for
reasons that have nothing to do with the person's recitation. Worth adding
to `normalize_text` if mantras starting with ॐ are common in your reference
texts — not fixed yet since it's a judgment call on how far normalization
should go, not an obvious bug fix.

## Notes on text normalization

`matcher.normalize_text` collapses Devanagari quirks that are ASR artifacts
rather than real mismatches, before scoring or diffing: avagraha (ऽ) and
nukta (़) are stripped, chandrabindu (ँ) is folded into anusvara (ं), and both
ASCII and Devanagari punctuation (। ॥) are removed. See the comments in
`vyas/matcher.py` for the reasoning behind each.

## Tuning the pass threshold

`PASS_THRESHOLD = 82.0` in `vyas/matcher.py` is a starting point, not a measured
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

Covers `vyas/matcher.py`'s normalization, scoring, and word-diff logic. There's no
mock-OpenRouter test for the routes yet — worth adding if this goes further.
