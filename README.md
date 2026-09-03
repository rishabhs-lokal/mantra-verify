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

### `POST /verify_batch`

Same form fields as `/verify`. Use this when one recording covers several
repetitions of the mantra back-to-back (e.g. "say it 11 times, then stop"),
instead of one recording per repetition.

`matcher.count_repetitions()` finds how many times the mantra appears in the
transcript using a **character-level** sliding window (not word-level) —
live testing found Whisper fuses words together with no spaces at all on
rapid, monotonous repeated speech (`"ओम्नमहशिवाय"` instead of
`"ओम् नमः शिवाय"`), which breaks a word-count window completely. All
detected repetitions are added to the counter in one call via
`counter.increment_by()`.

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

Two-stage decision, revised after live testing surfaced two problems with an
earlier single-stage version (chanting fast broke it silently; accented
speech was rejected too often):

1. **Repetition detection first** — `count_repetitions()` (the same
   character-level matcher `/verify_batch` uses) checks whether the
   utterance actually contains one or more back-to-back repetitions of the
   mantra, using `REPETITION_MATCH_THRESHOLD` (68.0, more lenient than
   `PASS_THRESHOLD`). If it finds N ≥ 1, all N are counted at once —
   `decision_source: "matched"`, `repetitions_counted: N`. This is what
   makes chanting speed a non-issue: however many repetitions the
   silence-gap detector failed to split into separate utterances, this
   still finds and counts correctly.
2. **Only if that finds nothing** does it fall back to a single
   whole-utterance comparison, exactly like the old logic:
   - `score >= PASS_THRESHOLD` (82.0) → counted, `decision_source: "fuzzy_pass"`
   - `score < AI_REVIEW_LOWER_BOUND` (35.0 — loosened from an initial 60.0
     after real accented speech kept scoring below that) → rejected,
     `decision_source: "fuzzy_fail"`
   - Otherwise (borderline) → `vyas.judge_chant()`, a chat-model call with a
     lenient judge prompt tolerant of ASR noise/accent —
     `decision_source: "ai_judged"`

An empty transcript (silence, or noise that slipped past the frontend's
minimum-utterance-duration filter) is `decision_source: "empty_transcript"`,
`counted: false` — treated as a normal, expected outcome in continuous
listening, not an error, unlike `/verify`'s 422 on the same condition.

Response: `{counted, repetitions_counted, decision_source, score, transcript, count, target_count, remaining, mala_complete, last_verified_at}`.
`repetitions_counted` (not just `counted`) is what gets added to the
persistent session+mantra counter via `counter.increment_by()`.

All four thresholds (`PASS_THRESHOLD`, `AI_REVIEW_LOWER_BOUND`,
`REPETITION_MATCH_THRESHOLD`, and the frontend's VAD constants) are
starting points based on limited real testing, not calibrated values —
expect to keep tuning them.

**Known limitation — no idempotency**: if the server successfully processes
a chant (transcribe + judge + increment) but the HTTP response is lost in
transit (a real occurrence seen during testing — a flaky connection dropped
the response after the server had already incremented the counter), the
client has no way to know the call actually succeeded. A naive retry would
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
(`vyas.TTS_MODEL`, `google/gemini-3.1-flash-tts-preview`) and returns
`audio/wav` bytes (not JSON) — the frontend plays this directly. `/chat` and
`/speak` are deliberately separate calls rather than one combined endpoint,
so the frontend can show Vyas's text reply immediately without waiting on
speech synthesis, and so a TTS failure doesn't take down the whole
conversation.

Note: OpenRouter's own docs reference an OpenAI TTS model
(`openai/gpt-4o-mini-tts-...`) that does not actually exist on the platform —
confirmed by querying the live `/api/v1/models?output_modalities=speech`
catalog, which has no OpenAI entries at all. Gemini's TTS is used instead.
It only outputs raw PCM (no mp3/wav option), so `vyas.synthesize_speech`
wraps it in a WAV header (`vyas._pcm_to_wav`) before returning it — a plain
`<audio>` tag can't play headerless PCM directly.

**Error responses on `/chat` and `/speak`** follow the same convention as
`/verify`: `429` (rate limit), `502` (key rejected or other OpenRouter
error), `504` (timeout), `500` (`OPENROUTER_API_KEY` not set). This mapping
lives in `openrouter_client.py`, shared by all three OpenRouter call sites
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

## Live Chanting Session

The "Live Chanting Session" block in the Recite panel (`static/app.js`,
bottom section) is a continuous-listening mode: start it once, then chant
into the mic — each recognized chant automatically counts down a visible
counter, no manual start/stop per repetition.

There is no streaming transcription (OpenRouter's Whisper endpoint is
one-shot request/response), so this segments your speech into individual
utterances itself, client-side, using simple volume-based voice activity
detection (VAD) — not a proper VAD library, just an RMS-over-threshold check
via the Web Audio API (`AnalyserNode`). When volume crosses
`SESSION_SPEECH_RMS_THRESHOLD` it starts recording; after
`SESSION_UTTERANCE_SILENCE_GAP_MS` of continuous silence it stops, finalizes
that utterance's clip, and sends it to `/verify_chant`. Utterances shorter
than `SESSION_MIN_UTTERANCE_MS` are discarded client-side without even
calling the server (almost certainly noise, not a real chant).

**These thresholds are untested against real microphone hardware or
environments** — they're a reasonable starting point, not calibrated
values. If chants aren't being detected, or background noise is triggering
false positives, these are the first constants to adjust (top of the "Live
Chanting Session" section in `app.js`). `SESSION_UTTERANCE_SILENCE_GAP_MS`
(500) and `SESSION_POLL_INTERVAL_MS` (75) were both lowered from their
initial values (700/150) for faster reaction — feedback said the original
timing felt sluggish.

**Non-visual feedback**: `playCountedTone()`/`playNotCountedTone()` play a
short synthesized chime (Web Audio API `OscillatorNode`, no TTS round-trip)
on every chant result — bright/short for counted, quiet/dull for not
counted. Added because you're not going to be reading the on-screen log
while chanting with your eyes closed; the tones give the same information
without requiring that.

**Silence timers** (per-decision from earlier discussion — only *counted*
chants reset them, not just any detected speech):
- 10s since the last counted chant (`SESSION_RECHANT_PROMPT_MS`) → Vyas
  speaks a prompt (`RECHANT_PROMPT_TEXT`) asking you to continue
- 15s since the last counted chant (`SESSION_PAUSE_MS`) → the session pauses
  entirely (stops listening) until you click **Resume** — this is
  intentionally not automatic

**Consecutive-error handling**: `SESSION_ERROR_STREAK_LIMIT` (3) tracks
not-counted attempts in a row, independent of the silence timers above — a
chanting *fast* isn't the same as chanting *wrong*. On the 3rd consecutive
rejection, Vyas re-speaks the mantra (via the same mechanism as "Hear the
mantra" below) as corrective pronunciation guidance, then the session
pauses exactly like the silence-timeout case — explicit Resume required,
consecutive-error count reset to 0.

**Vyas demonstrates the mantra**: a "🔊 Hear the mantra" button (next to the
reference-text field) speaks the reference text via `/speak` on demand, and
`startChantingSession()` also speaks it once automatically before listening
begins, so you have a correct-pronunciation reference before you start.

**Barge-in**: while Vyas is speaking during an active session (the initial
mantra demonstration, the 10s "please continue" prompt, the 3-error mantra
re-teaching, or a manual "Hear the mantra" click), `session.vyasSpeaking` is
set — but `pollSession()` doesn't fully stop, it switches to a lightweight
mode that only watches for sound and immediately calls `vyasAudio.pause()`
the instant any is detected, cutting him off rather than making you wait
for him to finish. This is also what prevents his own voice from leaking
through your speakers into the mic and registering as a false chant (the
same guard serves both purposes) — `speakAsVyas()` was changed from
resolving when playback *starts* to resolving when it *ends* specifically
to make this sequencing work, since callers need to know when he's
actually done (or interrupted) talking, not just when he started.

**Reassurance is spoken in Hindi**: `RECHANT_PROMPT_TEXT` and
`COMPLETION_PLACEHOLDER_TEXT` are Hindi regardless of the language
selector — these are Vyas's own reassurance, not mantra content, so they
don't follow the same language choice as transcription/chat.

**Completion line is a placeholder** — `COMPLETION_PLACEHOLDER_TEXT` in
`app.js` is spoken by Vyas when the counter hits zero. Swap it for the real
line whenever you have it; it's a single string constant, clearly marked.

**Counter always starts fresh**: `startChantingSession()` calls
`POST /count/{session_id}/reset` before beginning, so every session starts
its countdown at exactly the number you set. An earlier version resumed
from whatever count had already persisted for that session+mantra (meant
to preserve progress across page reloads), but during testing that read as
an unexplained drop rather than the intended behavior — simplicity won.

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
see `vyas.LANGUAGE_NAMES` for the full set this app recognizes.

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
