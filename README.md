# mantra_verify

FastAPI backend that verifies a spoken Hindu mantra against a Devanagari reference
text. Transcription runs on OpenRouter's cloud speech-to-text endpoint
(`openai/whisper-large-v3`); matching is local fuzzy text comparison
(rapidfuzz). Tracks verified repetition counts per session toward a target
(e.g. 108 for a mala).

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

```bash
curl -X POST http://127.0.0.1:8000/verify \
  -F "audio=@/path/to/your/recording.wav" \
  -F "reference_text=ॐ नमः शिवाय" \
  -F "session_id=demo-session-1" \
  -F "mantra_id=om-namah-shivaya" \
  -F "target_count=108"
```

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

## Notes on transcription language

Whisper has no dedicated Sanskrit language code. Since mantra reference text
here is Devanagari, `language="hi"` (Hindi) is used as the closest phonetic
match — see `main.py`'s `TRANSCRIPTION_LANGUAGE` constant.

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
