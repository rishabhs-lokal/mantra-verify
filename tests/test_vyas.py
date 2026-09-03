from vyas import parse_judge_response


class TestParseJudgeResponse:
    def test_exact_yes_is_true(self):
        assert parse_judge_response("YES") is True

    def test_yes_with_reason_is_true(self):
        assert parse_judge_response("YES, close enough given ASR noise") is True

    def test_lowercase_yes_is_true(self):
        assert parse_judge_response("yes this counts") is True

    def test_exact_no_is_false(self):
        assert parse_judge_response("NO") is False

    def test_no_with_reason_is_false(self):
        assert parse_judge_response("NO, completely unrelated speech") is False

    def test_empty_response_is_false(self):
        assert parse_judge_response("") is False

    def test_whitespace_only_response_is_false(self):
        assert parse_judge_response("   ") is False

    def test_malformed_response_is_false(self):
        # Anything that isn't exactly "YES" as the first word is a rejection —
        # better to under-count than to silently accept an unparseable reply.
        assert parse_judge_response("Maybe, it's hard to tell") is False
        assert parse_judge_response("I think so") is False

    def test_punctuation_after_yes_is_stripped(self):
        assert parse_judge_response("YES. This is a valid recitation.") is True
        assert parse_judge_response("YES: matches closely enough") is True
