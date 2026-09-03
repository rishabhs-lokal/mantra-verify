"""Text normalization and fuzzy scoring for spoken-vs-reference mantra comparison."""

import re
import unicodedata
from difflib import SequenceMatcher

from rapidfuzz import fuzz

PASS_THRESHOLD = 82.0

# Devanagari punctuation that has no Latin equivalent (danda / double danda).
_DEVANAGARI_PUNCTUATION = "।॥"

# ASCII punctuation Whisper sometimes injects around Devanagari transcripts.
_ASCII_PUNCTUATION = r"""!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~"""

_PUNCTUATION_RE = re.compile(f"[{re.escape(_ASCII_PUNCTUATION)}{_DEVANAGARI_PUNCTUATION}]")
_WHITESPACE_RE = re.compile(r"\s+")

# Avagraha (ऽ, U+093D) marks vowel elision in Sanskrit but is routinely dropped
# by ASR since it has no strong acoustic signal of its own. Strip it from both
# sides rather than penalize the speaker for an artifact of the transcriber.
_AVAGRAHA = "ऽ"

# Chandrabindu (ँ, U+0901) and anusvara (ं, U+0902) both mark nasalization and
# are frequently confused by ASR depending on how strongly the speaker nasalizes.
# Collapse chandrabindu into anusvara so this distinction doesn't cost points.
_CHANDRABINDU = "ँ"
_ANUSVARA = "ं"

# Nukta (़, U+093C) is used to represent loanword sounds (क़, ख़, ग़, ज़, फ़) but
# is inconsistently applied by both speakers and ASR output for Sanskrit terms
# that predate the Perso-Arabic borrowings nukta was introduced for. Stripping
# it merges e.g. ज़ back to ज for comparison purposes.
_NUKTA = "़"


def normalize_text(text: str) -> str:
    """Normalize Devanagari text for robust comparison.

    Applies NFC normalization, strips punctuation and common ASR-vs-reference
    Devanagari quirks (avagraha, nukta, chandrabindu/anusvara variance),
    collapses whitespace, and trims.
    """
    if not text:
        return ""

    text = unicodedata.normalize("NFC", text)
    text = text.replace(_AVAGRAHA, "")
    text = text.replace(_NUKTA, "")
    text = text.replace(_CHANDRABINDU, _ANUSVARA)
    text = _PUNCTUATION_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


def score_match(reference_text: str, spoken_text: str) -> float:
    """Return a 0-100 similarity score between reference and spoken text.

    Uses token_sort_ratio so word order differences (which don't change the
    meaning of a chanted mantra) don't get penalized as heavily as substitutions.
    """
    reference_normalized = normalize_text(reference_text)
    spoken_normalized = normalize_text(spoken_text)

    if not reference_normalized and not spoken_normalized:
        return 100.0
    if not reference_normalized or not spoken_normalized:
        return 0.0

    return fuzz.token_sort_ratio(reference_normalized, spoken_normalized)


def word_diff(reference_text: str, spoken_text: str) -> list:
    """Return an ordered word-level diff between reference and spoken text.

    Each entry is `[word, tag]` where tag is "match" (word appears in both,
    in-place), "missing" (reference word not spoken), or "extra" (spoken word
    not in reference). Uses difflib.SequenceMatcher over word tokens rather
    than a set-difference so word order and position are preserved in the
    output — useful for highlighting exactly where in the mantra a client
    should show the discrepancy, not just which words differ.
    """
    reference_words = normalize_text(reference_text).split()
    spoken_words = normalize_text(spoken_text).split()

    matcher = SequenceMatcher(None, reference_words, spoken_words, autojunk=False)
    diff = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            diff.extend([word, "match"] for word in reference_words[i1:i2])
        elif tag == "replace":
            diff.extend([word, "missing"] for word in reference_words[i1:i2])
            diff.extend([word, "extra"] for word in spoken_words[j1:j2])
        elif tag == "delete":
            diff.extend([word, "missing"] for word in reference_words[i1:i2])
        elif tag == "insert":
            diff.extend([word, "extra"] for word in spoken_words[j1:j2])

    return diff


def count_repetitions(reference_text: str, spoken_text: str, threshold: float = PASS_THRESHOLD) -> dict:
    """Count how many times reference_text was recited within one continuous
    spoken_text transcript — e.g. a single recording covering several japa
    repetitions back-to-back, rather than one recording per repetition.

    Operates on characters, not words: when a short phrase is repeated
    rapidly with little pause between repetitions, Whisper frequently fuses
    the words of a single repetition together with no space at all (e.g.
    "ओम्नमहशिवाय" instead of "ओम् नमः शिवाय") — confirmed empirically, not
    hypothetically. A word-count sliding window breaks completely on that
    output since `.split()` no longer yields one token per word. Stripping
    whitespace and sliding a reference-length *character* window instead
    sidesteps the problem, since it never depends on where — or whether —
    ASR placed spaces.
    """
    reference_chars = normalize_text(reference_text).replace(" ", "")
    spoken_chars = normalize_text(spoken_text).replace(" ", "")
    window_size = len(reference_chars)

    if window_size == 0 or not spoken_chars:
        return {"repetitions": 0, "segments": []}

    segments = []
    i = 0
    while i + window_size <= len(spoken_chars):
        window = spoken_chars[i : i + window_size]
        score = fuzz.ratio(reference_chars, window)
        if score >= threshold:
            segments.append({"text": window, "score": score})
            i += window_size
        else:
            i += 1

    return {"repetitions": len(segments), "segments": segments}


def completion_stats(diff: list) -> dict:
    """Derive how much of the reference mantra was actually recited, from a
    word_diff() result.

    "words_expected" only counts reference words (match + missing) — extra
    spoken words (filler, false starts) don't count for or against
    completion, since that's a question of whether the required content was
    said, not whether anything extra was added. The ratio is normalized to
    0.0-1.0 regardless of mantra length, so a fixed ratio threshold behaves
    consistently across a 3-word mantra and a 30-word one, unlike a raw
    missing-word count would.
    """
    words_matched = sum(1 for _, tag in diff if tag == "match")
    words_expected = sum(1 for _, tag in diff if tag in ("match", "missing"))
    ratio = 1.0 if words_expected == 0 else words_matched / words_expected

    return {
        "completion_ratio": ratio,
        "words_matched": words_matched,
        "words_expected": words_expected,
    }
