"""Intent classifier for routing agent commands to fast path or full pipeline.

Uses regex patterns for obvious commands (navigate, search) and falls back to
a cheap LLM call (gpt-4o-mini) for ambiguous instructions.
"""

import os
import re
import json
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ClassifiedIntent:
    action: str  # "fast_navigate", "fast_search", "complex"
    params: dict  # action-specific params


# Regex patterns for fast classification (no LLM needed).
# Full-URL patterns must come BEFORE domain patterns so that
# "open https://github.com/org" is not partially matched by the domain pattern.
_NAVIGATE_PATTERNS = [
    # Full URLs prefixed by a verb: "open https://github.com/anthropics"
    r"(?:go\s+to|open|navigate\s+to|visit|load)\s+(https?://\S+)",
    # Bare URL: "https://youtube.com/watch?v=..."
    r"^(https?://\S+)$",
    # Verb + domain: "go to youtube.com", "open google.com"
    r"(?:go\s+to|open|navigate\s+to|visit|load)\s+(.+?)\.(?:com|org|net|io|dev|co|ai|app|edu|gov|me|tv|gg|xyz)(?:\s|$|/.*)",
    # Bare domain: "youtube.com", "google.com"
    r"^([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*)\.(?:com|org|net|io|dev|co|ai|app|edu|gov|me|tv|gg|xyz)(?:\s*$|/.*$)",
    # Verb + short name (no TLD): "visit yt", "go to reddit", "open google"
    r"(?:go\s+to|open|navigate\s+to|visit|load)\s+([a-zA-Z0-9][-a-zA-Z0-9]{0,20})\s*$",
]

# Well-known site nicknames / abbreviations → full domain
_SITE_NICKNAMES: dict[str, str] = {
    'yt': 'youtube.com', 'youtube': 'youtube.com',
    'fb': 'facebook.com', 'facebook': 'facebook.com',
    'ig': 'instagram.com', 'insta': 'instagram.com', 'instagram': 'instagram.com',
    'tw': 'twitter.com', 'twitter': 'twitter.com', 'x': 'x.com',
    'reddit': 'reddit.com',
    'gh': 'github.com', 'github': 'github.com',
    'gm': 'gmail.com', 'gmail': 'gmail.com',
    'google': 'google.com',
    'amazon': 'amazon.com',
    'linkedin': 'linkedin.com',
    'netflix': 'netflix.com',
    'wiki': 'wikipedia.org', 'wikipedia': 'wikipedia.org',
    'so': 'stackoverflow.com', 'stackoverflow': 'stackoverflow.com',
}

_SEARCH_PATTERNS = [
    # "search for X on google", "google X", "search X"
    r"(?:search\s+(?:for\s+)?|google\s+|look\s+up\s+)(.+?)(?:\s+on\s+google)?$",
]


def _normalize_url(url_or_domain: str) -> str:
    """Ensure a URL or domain has a protocol prefix."""
    url = url_or_domain.strip()
    if url.startswith(("http://", "https://")):
        return url
    return f"https://{url}"


def _try_regex_classify(instruction: str) -> ClassifiedIntent | None:
    """Try to classify using regex patterns. Returns None if no match."""
    text = instruction.strip().lower()

    # The last pattern is the nickname pattern (verb + short name, no TLD)
    nickname_pattern = _NAVIGATE_PATTERNS[-1]

    # Check navigate patterns
    for pattern in _NAVIGATE_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            raw = match.group(1) if not text.startswith("http") else match.group(0)
            # Nickname pattern matched — resolve via lookup or fallback to .com
            if pattern is nickname_pattern:
                domain = _SITE_NICKNAMES.get(raw.strip(), f"{raw.strip()}.com")
                url = _normalize_url(domain)
                return ClassifiedIntent(action="fast_navigate", params={"url": url})
            # Reconstruct domain if needed
            if not raw.startswith("http"):
                # The pattern captures the part before TLD, reconstruct
                full_match = match.group(0)
                # Extract the domain from the full match
                domain_match = re.search(
                    r'([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\.[a-zA-Z]{2,})(?:/\S*)?',
                    instruction.strip()
                )
                if domain_match:
                    raw = domain_match.group(0)
            url = _normalize_url(raw)
            return ClassifiedIntent(action="fast_navigate", params={"url": url})

    # Check search patterns
    for pattern in _SEARCH_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            query = match.group(1).strip()
            url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
            return ClassifiedIntent(action="fast_navigate", params={"url": url})

    return None


async def _llm_classify(instruction: str) -> ClassifiedIntent:
    """Use a cheap LLM call to classify ambiguous instructions."""
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            max_tokens=200,
            messages=[
                {
                    "role": "system",
                    "content": """You classify browser commands into actions. Respond with JSON only.

Actions:
- "fast_navigate": User wants to go to a specific URL/website. Params: {"url": "https://..."}
- "fast_search": User wants to search for something. Params: {"query": "search terms"}
- "complex": Multi-step task requiring browsing, reading, interacting with pages.

Examples:
"go to youtube" → {"action": "fast_navigate", "params": {"url": "https://youtube.com"}}
"open reddit" → {"action": "fast_navigate", "params": {"url": "https://reddit.com"}}
"search for best laptops 2024" → {"action": "fast_search", "params": {"query": "best laptops 2024"}}
"find the cheapest flight from SF to NYC" → {"action": "complex", "params": {}}
"add item to cart on amazon" → {"action": "complex", "params": {}}
"what's the weather in tokyo" → {"action": "fast_search", "params": {"query": "weather in tokyo"}}
"scroll down" → {"action": "complex", "params": {}}
"click the login button" → {"action": "complex", "params": {}}

Respond with ONLY valid JSON."""
                },
                {"role": "user", "content": instruction}
            ],
        )

        text = response.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data = json.loads(text)

        action = data.get("action", "complex")
        params = data.get("params", {})

        # Convert fast_search to fast_navigate with google URL
        if action == "fast_search" and "query" in params:
            query = params["query"]
            url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
            return ClassifiedIntent(action="fast_navigate", params={"url": url})

        return ClassifiedIntent(action=action, params=params)

    except Exception as e:
        logger.warning(f"LLM classification failed: {e}, falling back to complex")
        return ClassifiedIntent(action="complex", params={})


async def classify(instruction: str) -> ClassifiedIntent:
    """Classify an instruction into a fast action or complex task.

    Regex-first. If no regex match, defaults to complex — never LLM.
    Asymmetric risk: wrong fast = broken task; wrong complex = slower but correct.
    """
    result = _try_regex_classify(instruction)
    if result:
        logger.info(f"Regex classified: {result.action} → {result.params}")
        return result

    logger.info(f"No regex match → complex: '{instruction}'")
    return ClassifiedIntent(action="complex", params={})
