"""Unit tests for the intent classifier.

These tests cover the regex fast-path only — no LLM calls are made.
The async `classify()` function falls through to `_try_regex_classify` for
all known-deterministic inputs, so no real OpenAI key is needed.
"""

import sys
import os
import pytest

# Make sure the backend package is importable when running from the repo root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from classifier import _try_regex_classify, _normalize_url, ClassifiedIntent


# ─────────────────────────────────────────────────────────────────────────────
# _normalize_url
# ─────────────────────────────────────────────────────────────────────────────

class TestNormalizeUrl:
    def test_adds_https_to_bare_domain(self):
        assert _normalize_url("youtube.com") == "https://youtube.com"

    def test_preserves_existing_https(self):
        assert _normalize_url("https://youtube.com") == "https://youtube.com"

    def test_preserves_existing_http(self):
        assert _normalize_url("http://localhost:3000") == "http://localhost:3000"

    def test_trims_whitespace(self):
        assert _normalize_url("  google.com  ") == "https://google.com"


# ─────────────────────────────────────────────────────────────────────────────
# Navigation patterns
# ─────────────────────────────────────────────────────────────────────────────

class TestNavigatePatterns:
    def _assert_navigate(self, instruction: str, expected_url_fragment: str):
        result = _try_regex_classify(instruction)
        assert result is not None, f"Expected a match for: {instruction!r}"
        assert result.action == "fast_navigate"
        assert expected_url_fragment in result.params["url"], (
            f"Expected {expected_url_fragment!r} in {result.params['url']!r}"
        )

    def test_go_to_domain(self):
        self._assert_navigate("go to youtube.com", "youtube.com")

    def test_open_domain(self):
        self._assert_navigate("open google.com", "google.com")

    def test_navigate_to_domain(self):
        self._assert_navigate("navigate to github.com", "github.com")

    def test_visit_domain(self):
        self._assert_navigate("visit reddit.com", "reddit.com")

    def test_bare_domain(self):
        self._assert_navigate("github.com", "github.com")

    def test_bare_domain_io(self):
        self._assert_navigate("linear.app", "linear.app")

    def test_full_https_url(self):
        self._assert_navigate("https://youtube.com/watch?v=abc123", "youtube.com")

    def test_go_to_full_https_url(self):
        self._assert_navigate("open https://github.com/anthropics", "github.com")

    def test_dev_tld(self):
        self._assert_navigate("go to vscode.dev", "vscode.dev")

    def test_ai_tld(self):
        self._assert_navigate("open claude.ai", "claude.ai")


# ─────────────────────────────────────────────────────────────────────────────
# Search patterns
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchPatterns:
    def _assert_search(self, instruction: str, expected_query_fragment: str):
        result = _try_regex_classify(instruction)
        assert result is not None, f"Expected a match for: {instruction!r}"
        assert result.action == "fast_navigate"
        assert "google.com/search" in result.params["url"]
        assert expected_query_fragment.replace(" ", "+") in result.params["url"], (
            f"Expected query fragment in {result.params['url']!r}"
        )

    def test_search_for(self):
        self._assert_search("search for best python libraries", "best+python+libraries")

    def test_google_verb(self):
        self._assert_search("google best laptops 2025", "best+laptops+2025")

    def test_look_up(self):
        # Classifier lowercases the instruction before regex matching, so query is lowercase
        self._assert_search("look up weather in Sydney", "weather+in+sydney")


# ─────────────────────────────────────────────────────────────────────────────
# Complex tasks (no regex match → None returned)
# ─────────────────────────────────────────────────────────────────────────────

class TestComplexTasks:
    def _assert_no_match(self, instruction: str):
        result = _try_regex_classify(instruction)
        assert result is None, (
            f"Expected no regex match for: {instruction!r}, but got {result}"
        )

    def test_flight_search(self):
        self._assert_no_match("find the cheapest flight from Sydney to Tokyo next month")

    def test_cart_action(self):
        self._assert_no_match("add the blue hoodie to cart")

    def test_form_fill(self):
        self._assert_no_match("fill out the contact form with my details")

    def test_scroll(self):
        self._assert_no_match("scroll down to the comments section")

    def test_click_element(self):
        self._assert_no_match("click the login button")

    def test_comparison(self):
        self._assert_no_match("compare the prices of iPhone 16 on Amazon and eBay")

    def test_booking(self):
        self._assert_no_match("book a hotel in Paris for 3 nights")


# ─────────────────────────────────────────────────────────────────────────────
# Async classify() integration (no LLM — falls through to complex)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestClassifyAsync:
    async def test_navigate_instruction(self):
        from classifier import classify
        result = await classify("go to youtube.com")
        assert result.action == "fast_navigate"
        assert "youtube.com" in result.params["url"]

    async def test_complex_instruction_returns_complex(self):
        from classifier import classify
        result = await classify("book a table at the best Italian restaurant nearby")
        assert result.action == "complex"

    async def test_bare_url(self):
        from classifier import classify
        result = await classify("https://anthropic.com")
        assert result.action == "fast_navigate"
        assert "anthropic.com" in result.params["url"]


# ─────────────────────────────────────────────────────────────────────────────
# Nickname / shorthand navigation (verb + short name, no TLD)
# ─────────────────────────────────────────────────────────────────────────────

class TestNicknameNavigation:
    def _assert_navigate(self, instruction: str, expected_url_fragment: str):
        result = _try_regex_classify(instruction)
        assert result is not None, f"Expected a match for: {instruction!r}"
        assert result.action == "fast_navigate"
        assert expected_url_fragment in result.params["url"], (
            f"Expected {expected_url_fragment!r} in {result.params['url']!r}"
        )

    def test_visit_yt(self):
        self._assert_navigate("visit yt", "youtube.com")

    def test_go_to_reddit(self):
        self._assert_navigate("go to reddit", "reddit.com")

    def test_open_gh(self):
        self._assert_navigate("open gh", "github.com")

    def test_unknown_fallback_to_com(self):
        self._assert_navigate("visit unknownsite", "unknownsite.com")

