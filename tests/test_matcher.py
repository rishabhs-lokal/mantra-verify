import unicodedata

import pytest

from matcher import PASS_THRESHOLD, completion_stats, normalize_text, score_match, word_diff

OM_NAMAH_SHIVAYA = "ॐ नमः शिवाय"


class TestNormalizeText:
    def test_empty_string(self):
        assert normalize_text("") == ""

    def test_none_like_falsy_input(self):
        assert normalize_text(None) == ""

    def test_passthrough_for_clean_text(self):
        assert normalize_text(OM_NAMAH_SHIVAYA) == OM_NAMAH_SHIVAYA

    def test_strips_ascii_punctuation(self):
        assert normalize_text("नमः, शिवाय!") == "नमः शिवाय"

    def test_strips_devanagari_danda(self):
        assert normalize_text("ॐ नमः शिवाय।") == "ॐ नमः शिवाय"

    def test_strips_devanagari_double_danda(self):
        assert normalize_text("ॐ नमः शिवाय॥") == "ॐ नमः शिवाय"

    def test_collapses_internal_whitespace(self):
        assert normalize_text("ॐ   नमः\n\nशिवाय") == "ॐ नमः शिवाय"

    def test_trims_leading_and_trailing_whitespace(self):
        assert normalize_text("  ॐ नमः शिवाय  ") == "ॐ नमः शिवाय"

    def test_strips_avagraha(self):
        # सोऽहम् (so'ham) — avagraha marks vowel elision and is routinely
        # dropped by ASR since it has weak/no acoustic signal.
        assert normalize_text("सोऽहम्") == normalize_text("सोहम्")
        assert "ऽ" not in normalize_text("सोऽहम्")

    def test_strips_nukta(self):
        # ज़ (nukta form, loanword /z/) should be treated the same as ज.
        assert normalize_text("ज़रा") == normalize_text("जरा")
        assert "़" not in normalize_text("ज़रा")

    def test_folds_chandrabindu_into_anusvara(self):
        # हँस (chandrabindu) vs हंस (anusvara) — both mark nasalization and
        # are frequently confused by ASR depending on nasalization strength.
        assert normalize_text("हँस") == normalize_text("हंस")

    def test_nfc_normalization_of_combining_forms(self):
        decomposed = unicodedata.normalize("NFD", OM_NAMAH_SHIVAYA)
        composed = unicodedata.normalize("NFC", OM_NAMAH_SHIVAYA)
        assert normalize_text(decomposed) == normalize_text(composed)

    def test_combination_of_quirks_in_one_string(self):
        reference = "ॐ नमः शिवाय।"
        spoken = "ॐ  नमः, शिवाय!!"
        assert normalize_text(reference) == normalize_text(spoken)


class TestScoreMatch:
    def test_identical_text_scores_100(self):
        assert score_match(OM_NAMAH_SHIVAYA, OM_NAMAH_SHIVAYA) == 100.0

    def test_both_empty_scores_100(self):
        assert score_match("", "") == 100.0

    def test_reference_empty_spoken_present_scores_0(self):
        assert score_match("", OM_NAMAH_SHIVAYA) == 0.0

    def test_spoken_empty_reference_present_scores_0(self):
        assert score_match(OM_NAMAH_SHIVAYA, "") == 0.0

    def test_completely_unrelated_text_scores_low(self):
        score = score_match(OM_NAMAH_SHIVAYA, "गंगा जल पवित्र होता है")
        assert score < PASS_THRESHOLD

    def test_word_order_difference_still_scores_highly(self):
        # token_sort_ratio sorts tokens before comparing, so a chanted
        # mantra spoken with words out of order shouldn't be penalized hard.
        reordered = "शिवाय नमः ॐ"
        assert score_match(OM_NAMAH_SHIVAYA, reordered) >= PASS_THRESHOLD

    def test_devanagari_asr_quirks_do_not_reduce_score(self):
        reference = "सोऽहम्"
        spoken_without_avagraha = "सोहम्"
        assert score_match(reference, spoken_without_avagraha) == 100.0

    def test_single_word_substitution_drops_below_identical(self):
        reference = OM_NAMAH_SHIVAYA
        one_word_wrong = "ॐ नमः विष्णवे"
        score = score_match(reference, one_word_wrong)
        assert score < 100.0

    def test_score_is_within_valid_range(self):
        score = score_match(OM_NAMAH_SHIVAYA, "यादृच्छिक पाठ")
        assert 0.0 <= score <= 100.0


def _tags(diff, tag):
    return [word for word, t in diff if t == tag]


class TestWordDiff:
    def test_identical_text_has_no_missing_or_extra(self):
        result = word_diff(OM_NAMAH_SHIVAYA, OM_NAMAH_SHIVAYA)
        assert result == [["ॐ", "match"], ["नमः", "match"], ["शिवाय", "match"]]

    def test_missing_word(self):
        result = word_diff(OM_NAMAH_SHIVAYA, "ॐ नमः")
        assert _tags(result, "match") == ["ॐ", "नमः"]
        assert _tags(result, "missing") == ["शिवाय"]
        assert _tags(result, "extra") == []

    def test_extra_word(self):
        result = word_diff("ॐ नमः", OM_NAMAH_SHIVAYA)
        assert _tags(result, "match") == ["ॐ", "नमः"]
        assert _tags(result, "missing") == []
        assert _tags(result, "extra") == ["शिवाय"]

    def test_completely_disjoint_text(self):
        result = word_diff("ॐ नमः शिवाय", "गंगा जल पवित्र")
        assert _tags(result, "match") == []
        assert sorted(_tags(result, "missing")) == sorted(["ॐ", "नमः", "शिवाय"])
        assert sorted(_tags(result, "extra")) == sorted(["गंगा", "जल", "पवित्र"])

    def test_word_diff_preserves_order(self):
        # A substitution in the middle should keep the surrounding matches
        # in their original positions, not group all matches/mismatches together.
        result = word_diff(OM_NAMAH_SHIVAYA, "ॐ विष्णवे शिवाय")
        assert result == [
            ["ॐ", "match"],
            ["नमः", "missing"],
            ["विष्णवे", "extra"],
            ["शिवाय", "match"],
        ]

    def test_repeated_word_multiplicity_is_respected(self):
        # Reference repeats "राम" three times; spoken only says it twice —
        # one occurrence should be reported missing, not silently matched.
        reference = "राम राम राम"
        spoken = "राम राम"
        result = word_diff(reference, spoken)
        assert _tags(result, "match") == ["राम", "राम"]
        assert _tags(result, "missing") == ["राम"]
        assert _tags(result, "extra") == []

    def test_repeated_word_with_extra_occurrence(self):
        reference = "राम राम"
        spoken = "राम राम राम"
        result = word_diff(reference, spoken)
        assert _tags(result, "match") == ["राम", "राम"]
        assert _tags(result, "missing") == []
        assert _tags(result, "extra") == ["राम"]

    def test_empty_reference_and_spoken(self):
        assert word_diff("", "") == []

    def test_diff_ignores_punctuation_and_devanagari_quirks(self):
        result = word_diff("ॐ नमः शिवाय।", "ॐ नमः, शिवाय")
        assert _tags(result, "missing") == []
        assert _tags(result, "extra") == []


class TestCompletionStats:
    def test_full_recitation_scores_ratio_1(self):
        diff = word_diff(OM_NAMAH_SHIVAYA, OM_NAMAH_SHIVAYA)
        stats = completion_stats(diff)
        assert stats == {"completion_ratio": 1.0, "words_matched": 3, "words_expected": 3}

    def test_stopping_partway_through_reduces_ratio(self):
        # Only said the first 2 of 3 words — simulates giving up mid-mantra.
        diff = word_diff(OM_NAMAH_SHIVAYA, "ॐ नमः")
        stats = completion_stats(diff)
        assert stats["words_matched"] == 2
        assert stats["words_expected"] == 3
        assert stats["completion_ratio"] == pytest.approx(2 / 3)

    def test_completely_disjoint_text_scores_ratio_0(self):
        diff = word_diff(OM_NAMAH_SHIVAYA, "गंगा जल पवित्र")
        stats = completion_stats(diff)
        assert stats["completion_ratio"] == 0.0

    def test_empty_reference_is_vacuously_complete(self):
        diff = word_diff("", "")
        stats = completion_stats(diff)
        assert stats == {"completion_ratio": 1.0, "words_matched": 0, "words_expected": 0}

    def test_extra_spoken_words_do_not_affect_ratio(self):
        # Filler/false-start words on top of a full recitation shouldn't
        # penalize completion — every reference word was still said.
        diff = word_diff(OM_NAMAH_SHIVAYA, f"उम {OM_NAMAH_SHIVAYA} उम")
        stats = completion_stats(diff)
        assert stats["completion_ratio"] == 1.0
        assert stats["words_expected"] == 3

    def test_ratio_is_length_normalized_across_mantra_sizes(self):
        # Missing one word out of a short mantra vs. a long one should land
        # at very different ratios, even though it's "one word" in both —
        # this is the whole point of a ratio over a raw missing-word count.
        short_diff = word_diff("ॐ नमः शिवाय", "ॐ नमः")
        long_reference = " ".join(["शिवाय"] * 30)
        long_spoken = " ".join(["शिवाय"] * 29)
        long_diff = word_diff(long_reference, long_spoken)

        short_ratio = completion_stats(short_diff)["completion_ratio"]
        long_ratio = completion_stats(long_diff)["completion_ratio"]

        assert short_ratio == pytest.approx(2 / 3)
        assert long_ratio == pytest.approx(29 / 30)
        assert long_ratio > short_ratio

    def test_repeated_word_multiplicity_is_respected(self):
        diff = word_diff("राम राम राम", "राम राम")
        stats = completion_stats(diff)
        assert stats == {"completion_ratio": pytest.approx(2 / 3), "words_matched": 2, "words_expected": 3}
