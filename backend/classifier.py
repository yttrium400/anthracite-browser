"""Intent classifier for routing agent commands to fast path or full pipeline.

Uses regex patterns for obvious commands (navigate, search, scroll, back/forward)
and falls back to a cheap LLM call (gpt-4o-mini) for ambiguous instructions.

Design goal: maximize regex hits to avoid LLM latency + cost for common commands.
Every regex match = 0ms + $0. Every LLM fallback = 200-500ms + ~100 tokens.
"""

import os
import re
import json
import logging
import time
from dataclasses import dataclass, field
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)


@dataclass
class ClassifiedIntent:
    action: str  # "fast_navigate", "fast_scroll", "fast_back", "fast_forward", "fast_reload", "complex"
    params: dict  # action-specific params
    classify_time_ms: float = 0.0  # how long classification took
    classify_method: str = ""  # "regex" or "llm"


# ── Well-known sites (no TLD needed) ────────────────────────────────────────

_KNOWN_SITES = {
    "youtube": "https://youtube.com",
    "google": "https://google.com",
    "gmail": "https://mail.google.com",
    "twitter": "https://twitter.com",
    "x": "https://x.com",
    "reddit": "https://reddit.com",
    "facebook": "https://facebook.com",
    "instagram": "https://instagram.com",
    "linkedin": "https://linkedin.com",
    "github": "https://github.com",
    "amazon": "https://amazon.com",
    "netflix": "https://netflix.com",
    "spotify": "https://open.spotify.com",
    "twitch": "https://twitch.tv",
    "wikipedia": "https://wikipedia.org",
    "chatgpt": "https://chatgpt.com",
    "claude": "https://claude.ai",
    "whatsapp": "https://web.whatsapp.com",
    "discord": "https://discord.com",
    "slack": "https://slack.com",
    "notion": "https://notion.so",
    "figma": "https://figma.com",
    "stackoverflow": "https://stackoverflow.com",
    "stack overflow": "https://stackoverflow.com",
    "hacker news": "https://news.ycombinator.com",
    "hackernews": "https://news.ycombinator.com",
    "hn": "https://news.ycombinator.com",
    "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com",
    "drive": "https://drive.google.com",
    "google drive": "https://drive.google.com",
    "docs": "https://docs.google.com",
    "google docs": "https://docs.google.com",
    "sheets": "https://sheets.google.com",
    "google sheets": "https://sheets.google.com",
    "calendar": "https://calendar.google.com",
    "google calendar": "https://calendar.google.com",
    "outlook": "https://outlook.live.com",
    "yahoo": "https://yahoo.com",
    "yahoo mail": "https://mail.yahoo.com",
    "bing": "https://bing.com",
    "tiktok": "https://tiktok.com",
    "pinterest": "https://pinterest.com",
    "ebay": "https://ebay.com",
    "walmart": "https://walmart.com",
    "target": "https://target.com",
    "etsy": "https://etsy.com",
    "airbnb": "https://airbnb.com",
    "booking": "https://booking.com",
    "expedia": "https://expedia.com",
    "kayak": "https://kayak.com",
    "uber": "https://uber.com",
    "lyft": "https://lyft.com",
    "doordash": "https://doordash.com",
    "grubhub": "https://grubhub.com",
    "zillow": "https://zillow.com",
    "craigslist": "https://craigslist.org",
    "medium": "https://medium.com",
    "substack": "https://substack.com",
    "vercel": "https://vercel.com",
    "netlify": "https://netlify.com",
    "aws": "https://aws.amazon.com",
    "azure": "https://portal.azure.com",
    "heroku": "https://heroku.com",
    "stripe": "https://dashboard.stripe.com",
    "paypal": "https://paypal.com",
}

# ── Regex patterns ───────────────────────────────────────────────────────────

_NAVIGATE_PATTERNS = [
    # "go to youtube.com", "open google.com/maps", "navigate to github.com"
    r"(?:go\s+to|open|navigate\s+to|visit|load|head\s+to|take\s+me\s+to|pull\s+up)\s+(.+?)\.(?:com|org|net|io|dev|co|ai|app|edu|gov|me|tv|gg|xyz|so|fm)(?:\s|$|/.*)",
    # "youtube.com", "google.com" (bare domain)
    r"^([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*)\.(?:com|org|net|io|dev|co|ai|app|edu|gov|me|tv|gg|xyz|so|fm)(?:\s*$|/.*$)",
    # Full URLs
    r"(?:go\s+to|open|navigate\s+to|visit|load|head\s+to|take\s+me\s+to|pull\s+up)\s+(https?://\S+)",
    # Bare URL
    r"^(https?://\S+)$",
]

_SEARCH_PATTERNS = [
    # "search for X", "google X", "search X", "look up X"
    r"(?:search\s+(?:for\s+)?|google\s+|look\s+up\s+|find\s+me\s+)(.+?)(?:\s+on\s+google)?$",
    # Question-form searches: "what is X", "what's the weather", "how to X", "who is X", "when is X"
    r"^((?:what(?:'s|\s+is|\s+are|\s+was|\s+were)|how\s+(?:to|do|does|much|many|long|far)|who\s+(?:is|are|was)|where\s+(?:is|are|can)|when\s+(?:is|does|did|will)|why\s+(?:is|are|do|does)|can\s+(?:i|you|we))\s+.+)$",
    # "define X", "meaning of X"
    r"^(?:define\s+|meaning\s+of\s+|definition\s+of\s+)(.+)$",
    # "X near me", "restaurants near me"
    r"^(.+\s+near\s+me)$",
    # "weather in X", "time in X", "news about X"
    r"^((?:weather|time|news|score|stocks?|price\s+of)\s+(?:in|for|about|of)\s+.+)$",
    # "weather", "news" (bare keywords that are always searches)
    r"^(weather|news|stocks|scores)$",
    # "translate X to Y"
    r"^(translate\s+.+)$",
    # "convert X to Y"
    r"^(convert\s+.+)$",
    # "X vs Y"
    r"^(.+\s+vs\.?\s+.+)$",
    # "best X for Y", "top X"
    r"^((?:best|top|cheapest|fastest|most\s+popular)\s+.+)$",
]

_SCROLL_PATTERNS = [
    r"^(?:scroll|page)\s+(down|up|left|right)(?:\s+(\d+))?",
    r"^(?:scroll\s+to\s+(?:the\s+)?)(top|bottom)$",
    r"^(page\s+down|page\s+up)$",
]

_BACK_PATTERNS = [
    r"^(?:go\s+)?back$",
    r"^(?:go\s+to\s+)?(?:the\s+)?previous\s+page$",
    r"^back\s+(?:a\s+)?page$",
]

_FORWARD_PATTERNS = [
    r"^(?:go\s+)?forward$",
    r"^(?:go\s+to\s+)?(?:the\s+)?next\s+page$",
    r"^forward\s+(?:a\s+)?page$",
]

_RELOAD_PATTERNS = [
    r"^(?:reload|refresh|hard\s+refresh)(?:\s+(?:the\s+)?page)?$",
]


# ── Classification Logic ────────────────────────────────────────────────────

def _normalize_url(url_or_domain: str) -> str:
    """Ensure a URL or domain has a protocol prefix."""
    url = url_or_domain.strip()
    if url.startswith(("http://", "https://")):
        return url
    return f"https://{url}"


def _try_known_site(instruction: str) -> ClassifiedIntent | None:
    """Check if the instruction references a well-known site by name."""
    text = instruction.strip().lower()

    # Strip "go to", "open", etc. prefix
    prefixes = ["go to ", "open ", "navigate to ", "visit ", "load ",
                 "head to ", "take me to ", "pull up ", "show me ", "launch "]
    for prefix in prefixes:
        if text.startswith(prefix):
            text = text[len(prefix):]
            break

    # Exact match against known sites
    if text in _KNOWN_SITES:
        return ClassifiedIntent(action="fast_navigate", params={"url": _KNOWN_SITES[text]})

    return None


_ON_SITE_PATTERN = re.compile(
    r"\b(?:on|in|from|at)\s+(?:" + "|".join(re.escape(s) for s in _KNOWN_SITES) + r")\b",
    re.IGNORECASE,
)


def _try_regex_classify(instruction: str) -> ClassifiedIntent | None:
    """Try to classify using regex patterns. Returns None if no match."""
    text = instruction.strip().lower()

    # 1. Check known sites first (highest confidence, handles "open youtube" etc.)
    result = _try_known_site(instruction)
    if result:
        return result

    # 1.5. If the instruction mentions doing something "on <specific site>",
    # it's a multi-step task (navigate to site, then act) — bail to complex.
    # Exception: "on google" is fine since search patterns already handle that.
    if _ON_SITE_PATTERN.search(text) and "on google" not in text:
        return None

    # 2. Check navigate patterns (domains + URLs)
    for pattern in _NAVIGATE_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            raw = match.group(1) if not text.startswith("http") else match.group(0)
            if not raw.startswith("http"):
                domain_match = re.search(
                    r'([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\.[a-zA-Z]{2,})(?:/\S*)?',
                    instruction.strip()
                )
                if domain_match:
                    raw = domain_match.group(0)
            url = _normalize_url(raw)
            return ClassifiedIntent(action="fast_navigate", params={"url": url})

    # 3. Check search patterns
    for pattern in _SEARCH_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            query = match.group(1).strip()
            url = f"https://www.google.com/search?q={quote_plus(query)}"
            return ClassifiedIntent(action="fast_navigate", params={"url": url})

    # 4. Check scroll patterns
    for pattern in _SCROLL_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            direction = match.group(1).lower()
            if direction == "top" or direction == "page up":
                return ClassifiedIntent(action="fast_scroll", params={"direction": "up", "amount": 99999})
            elif direction == "bottom" or direction == "page down":
                return ClassifiedIntent(action="fast_scroll", params={"direction": "down", "amount": 99999})
            amount = int(match.group(2)) if match.lastindex and match.lastindex >= 2 and match.group(2) else 500
            return ClassifiedIntent(action="fast_scroll", params={"direction": direction, "amount": amount})

    # 5. Check back/forward/reload
    for pattern in _BACK_PATTERNS:
        if re.match(pattern, text, re.IGNORECASE):
            return ClassifiedIntent(action="fast_back", params={})

    for pattern in _FORWARD_PATTERNS:
        if re.match(pattern, text, re.IGNORECASE):
            return ClassifiedIntent(action="fast_forward", params={})

    for pattern in _RELOAD_PATTERNS:
        if re.match(pattern, text, re.IGNORECASE):
            return ClassifiedIntent(action="fast_reload", params={})

    return None


async def _llm_classify(instruction: str) -> ClassifiedIntent:
    """Use a cheap LLM call to classify ambiguous instructions."""
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            max_tokens=150,
            messages=[
                {
                    "role": "system",
                    "content": """Classify browser commands into actions. Respond with JSON only.

Actions:
- "fast_navigate": ONLY for going to a specific URL/website with NO further interaction needed. Params: {"url": "https://..."}
- "fast_search": ONLY for showing search results with NO further interaction needed. Params: {"query": "search terms"}
- "fast_scroll": Scroll the page. Params: {"direction": "down|up", "amount": 500}
- "fast_back": Go to previous page. Params: {}
- "fast_forward": Go to next page. Params: {}
- "fast_reload": Reload page. Params: {}
- "complex": ANY task that requires clicking, playing, selecting, reading content, filling forms, or interacting with page elements AFTER navigation. If the user wants to DO something on a site (play a video, buy something, read an article, log in, etc.), it is ALWAYS complex.

Examples:
"go to youtube" → {"action": "fast_navigate", "params": {"url": "https://youtube.com"}}
"search for best laptops" → {"action": "fast_search", "params": {"query": "best laptops"}}
"scroll down" → {"action": "fast_scroll", "params": {"direction": "down", "amount": 500}}
"go back" → {"action": "fast_back", "params": {}}
"find cheapest flight SF to NYC" → {"action": "complex", "params": {}}
"click login button" → {"action": "complex", "params": {}}
"fill out the form" → {"action": "complex", "params": {}}
"add to cart" → {"action": "complex", "params": {}}
"play dua lipa on youtube" → {"action": "complex", "params": {}}
"play a song" → {"action": "complex", "params": {}}
"watch a video on youtube" → {"action": "complex", "params": {}}
"read the top post on hacker news" → {"action": "complex", "params": {}}
"buy shoes on amazon" → {"action": "complex", "params": {}}
"log into gmail" → {"action": "complex", "params": {}}

JSON only:"""
                },
                {"role": "user", "content": instruction}
            ],
        )

        text = response.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data = json.loads(text)

        action = data.get("action", "complex")
        params = data.get("params", {})

        # Convert fast_search to fast_navigate with google URL
        if action == "fast_search" and "query" in params:
            query = params["query"]
            url = f"https://www.google.com/search?q={quote_plus(query)}"
            return ClassifiedIntent(action="fast_navigate", params={"url": url})

        return ClassifiedIntent(action=action, params=params)

    except Exception as e:
        logger.warning(f"LLM classification failed: {e}, falling back to complex")
        return ClassifiedIntent(action="complex", params={})


async def classify(instruction: str) -> ClassifiedIntent:
    """Classify an instruction into a fast action or complex task.

    Tries regex first (instant), falls back to LLM (200-500ms).
    Returns ClassifiedIntent with timing info for benchmarking.
    """
    start = time.time()

    # 1. Try regex (free, instant)
    result = _try_regex_classify(instruction)
    if result:
        result.classify_time_ms = (time.time() - start) * 1000
        result.classify_method = "regex"
        logger.info(f"Regex classified ({result.classify_time_ms:.1f}ms): {result.action} → {result.params}")
        return result

    # 2. No regex match → default to complex (safe: agent handles everything, just slower)
    # Previously used an LLM fallback here, but the asymmetric risk isn't worth it:
    # misclassifying complex→fast = task fails silently, fast→complex = just ~5s slower.
    result = ClassifiedIntent(action="complex", params={})
    result.classify_time_ms = (time.time() - start) * 1000
    result.classify_method = "default"
    logger.info(f"No regex match ({result.classify_time_ms:.1f}ms): defaulting to complex")
    return result
