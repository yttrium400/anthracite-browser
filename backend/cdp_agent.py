"""Custom CDP-based browser agent for Anthracite.

Replaces browser-use with a direct AX-tree → LLM → CDP action loop:
- Persistent single WebSocket connection per task (no reconnect per action)
- Accessibility tree as primary page context (not screenshots)
- Screenshot available as an explicit fallback tool
- Native OpenAI tool use API (no LangChain overhead)
- Operates on the current active tab, not a spawned sandbox

Architecture:
  CDPAgentSession  — persistent WS, AX tree capture, action execution
  CDPAgent         — tool definitions + LLM loop with append-only history
"""

import asyncio
import json
import logging
import os
import re
from typing import Any, Callable, Awaitable

import aiohttp

logger = logging.getLogger(__name__)

CDP_PORT = 9222
MAX_STEPS = 25
# How many recent step-triplets (assistant + tool + user) to keep in the API
# call's message window. Older steps are dropped to prevent context bloat.
# Each step = 3 messages. System + first-user task are always kept.
# Research recommends 10-15 for complex tasks (Browser-Use, 2024-2025).
CONTEXT_WINDOW_STEPS = 10

# Executor model. gpt-4o is required — gpt-4o-mini hallucinates specific data
# (prices, names) it cannot see in the AX tree rather than admitting uncertainty.
# Rate limits are not an issue with the sliding context window (1 call/step, ~10 steps max).
AGENT_MODEL = "gpt-4o"
# Planner: one call, gpt-4o-mini is fine for producing a step list
PLANNER_MODEL = "gpt-4o-mini"
# Escalation fallback (same model, kept for symmetry — gpt-4o is already the default)
FALLBACK_MODEL = "gpt-4o"
MAX_INTERACTIVE_LINES = 120  # max labeled interactive elements to show in output
MAX_CONTENT_LINES = 30

# Roles whose nodes get a [N] label (interactive)
_INTERACTIVE_ROLES = {
    "button", "link", "textbox", "searchbox", "combobox",
    "checkbox", "radio", "menuitem", "option", "tab",
    "spinbutton", "slider", "switch", "menuitemcheckbox",
    "menuitemradio", "treeitem", "gridcell", "columnheader",
}

# Input-type roles that are always floated to the TOP of AX output,
# so they're never hidden below the MAX_INTERACTIVE_LINES cap.
_INPUT_ROLES = {"textbox", "searchbox", "combobox", "spinbutton"}

# Roles that contribute readable content text (no label)
_HEADING_ROLES = {"heading"}
_TEXT_ROLES = {"StaticText", "text"}

# ─────────────────────────────────────────────────────────────────────────────
# System prompt — stable across all tasks, maximises KV cache hits
# ─────────────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a browser agent controlling a real web browser tab. \
Each step you receive the current page state as a compact accessibility tree \
with numbered interactive elements [1], [2], etc.

Call EXACTLY ONE tool per response. Available tools:

• click(index)                  — click element [N]
• type_text(index, text)        — clear field [N] and type text
• type_and_submit(index, text)  — type text into [N] and press Enter
• navigate(url)                 — navigate to a full URL
• scroll(direction, amount)     — scroll "up"/"down"/"left"/"right" by pixels (default 500)
• screenshot()                  — capture screenshot; use for canvas/charts/visual content
• extract_text()                — get the full visible text of the page
• done(result)                  — mark task complete with a result summary

CRITICAL — when to call done():
done() means the END GOAL is fully achieved, not just that you started:
- "play music on YouTube" → done() ONLY after you clicked a video and it is loading
- "search for X" → done() ONLY after search results are visible
- "find X" → done() ONLY after you have the answer, include it in result
- "buy X" → done() ONLY after checkout is confirmed
- Navigating to a site is NEVER the final step unless the task is literally "go to X"

Multi-step workflow for "do X on Y":
  1. Navigate to Y (if not already there)
  2. Interact with Y to accomplish X — search, click, fill forms, etc.
  3. Confirm X is done, then call done()

Site selection — always start at the right site for the task:
- Flights (cheapest flight, book flight, flight prices): navigate to https://www.google.com/flights
- Hotels/accommodation (hotel, stay, accommodation): navigate to https://www.booking.com
- Shopping (buy, order, price for product): navigate to https://www.amazon.com.au or https://www.google.com/shopping
- General search/information: navigate to https://www.google.com

Input fields — the page state shows "Input fields:" at the top. ALWAYS fill those
before clicking any button. A "Search" button does nothing if its input is empty.
Fields show their current value as `value: "..."` — if a field already has the wrong
value, type_text will replace it with the correct one.

Other rules:
- For search boxes, prefer type_and_submit (types + presses Enter in one step).
- After type_and_submit on a search box the URL should change to a results page.
  If the URL is unchanged and no results are visible, the submit failed — do NOT
  scroll endlessly. Instead navigate() directly to the search URL, e.g.
  https://www.youtube.com/results?search_query=punjabi+music
- After type_text, if new option/listitem/suggestion elements appear in the page
  state, you are seeing an autocomplete dropdown. Click the correct suggestion
  before moving to the next field — do NOT type in the next field first.
- If clicking a field causes a calendar/date-picker to appear in the page state,
  interact with it by clicking the correct date — do not type the date as text.
- If an element is not visible and scrolling twice didn't help, try a different approach.
- After 2 steps with identical page states, try a completely different approach."""

# ─────────────────────────────────────────────────────────────────────────────
# Tool definitions for OpenAI
# ─────────────────────────────────────────────────────────────────────────────
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "click",
            "description": "Click an interactive element by its [N] index number",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "The [N] number shown in the page state"},
                },
                "required": ["index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "type_text",
            "description": "Clear an input field and type text into it",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "The [N] number of the input element"},
                    "text": {"type": "string", "description": "Text to type"},
                },
                "required": ["index", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "type_and_submit",
            "description": "Type text into an input field and press Enter to submit",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "The [N] number of the input element"},
                    "text": {"type": "string", "description": "Text to type"},
                },
                "required": ["index", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "Navigate the browser to a URL",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Full URL (include https://)"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scroll",
            "description": "Scroll the page",
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": {
                        "type": "string",
                        "enum": ["up", "down", "left", "right"],
                    },
                    "amount": {"type": "integer", "description": "Pixels (default 500)", "default": 500},
                },
                "required": ["direction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "screenshot",
            "description": "Take a screenshot. Use when AX tree lacks enough info (canvas, charts, images).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_text",
            "description": "Get the full visible text of the current page",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "done",
            "description": "Mark the task as complete and return a result summary",
            "parameters": {
                "type": "object",
                "properties": {
                    "result": {"type": "string", "description": "What was accomplished"},
                },
                "required": ["result"],
            },
        },
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Planner — one cheap call before the executor loop
# ─────────────────────────────────────────────────────────────────────────────

async def _plan_task(instruction: str, page_context: str, client) -> str:
    """Produce an explicit numbered step list before the executor loop begins.

    A single cheap planning call dramatically improves reliability on multi-step
    tasks (autocomplete fields, date pickers, multi-page flows) by giving the
    executor a concrete checklist instead of reasoning the entire task from scratch
    at each step.  Mirrors the Planner+Executor pattern used by Comet, Mariner, etc.
    """
    try:
        resp = await client.chat.completions.create(
            model=PLANNER_MODEL,
            temperature=0,
            max_tokens=400,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a browser task planner. Given a task and the current page, "
                        "produce a concise numbered plan (3–8 steps) for a browser agent.\n\n"
                        "Rules:\n"
                        "- After typing in ANY search or autocomplete field, ALWAYS add a "
                        "  separate step: 'Click the [correct] autocomplete suggestion'\n"
                        "- For date fields on travel/booking sites, click the calendar — "
                        "  do NOT type the date as text\n"
                        "- Be explicit about what text to type and what to look for\n"
                        "- Last step: 'Verify [expected result] is visible, then call done()'\n"
                        "- Respond with ONLY a numbered list, no preamble."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Task: {instruction}\n\nCurrent page:\n{page_context[:600]}",
                },
            ],
        )
        plan = resp.choices[0].message.content.strip()
        logger.info(f"[Planner] Plan:\n{plan}")
        return plan
    except Exception as e:
        logger.warning(f"[Planner] Failed ({e}) — proceeding without plan")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Persistent CDP session
# ─────────────────────────────────────────────────────────────────────────────

async def _get_ws_url(target_id: str) -> str:
    async with aiohttp.ClientSession() as s:
        async with s.get(f"http://127.0.0.1:{CDP_PORT}/json") as resp:
            targets = await resp.json(content_type=None)
            for t in targets:
                if t.get("id") == target_id:
                    return t["webSocketDebuggerUrl"]
    raise ValueError(f"CDP target not found: {target_id}")


class CDPAgentSession:
    """Single persistent WebSocket connection to one CDP target.

    Stays open for the entire task — no reconnect per action.
    Also owns the element-index map rebuilt on each AX tree capture.
    """

    def __init__(self, target_id: str):
        self.target_id = target_id
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._http: aiohttp.ClientSession | None = None
        self._msg_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._reader: asyncio.Task | None = None
        # label index → backendDOMNodeId (rebuilt each step)
        self._element_map: dict[int, int] = {}
        # label index → human-readable description for debug logging
        self._element_names: dict[int, str] = {}

    async def connect(self):
        ws_url = await _get_ws_url(self.target_id)
        self._http = aiohttp.ClientSession()
        self._ws = await self._http.ws_connect(ws_url, max_msg_size=50 * 1024 * 1024)
        self._reader = asyncio.create_task(self._read_loop())
        # Enable Accessibility domain so backendDOMNodeIds stay consistent
        await self.send("Accessibility.enable")

    async def close(self):
        if self._reader:
            self._reader.cancel()
            try:
                await self._reader
            except asyncio.CancelledError:
                pass
        if self._ws:
            await self._ws.close()
        if self._http:
            await self._http.close()

    async def _read_loop(self):
        try:
            async for msg in self._ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    mid = data.get("id")
                    if mid is not None and mid in self._pending:
                        self._pending[mid].set_result(data)
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break
        except asyncio.CancelledError:
            pass

    async def send(self, method: str, params: dict | None = None, timeout: float = 15.0) -> dict:
        self._msg_id += 1
        mid = self._msg_id
        msg = {"id": mid, "method": method}
        if params:
            msg["params"] = params
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[mid] = fut
        await self._ws.send_json(msg)
        try:
            result = await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending.pop(mid, None)
        if "error" in result:
            raise RuntimeError(f"CDP {method} error: {result['error']}")
        return result.get("result", {})

    # ── Page state ─────────────────────────────────────────────────────────

    async def get_page_info(self) -> dict:
        try:
            result = await self.send("Runtime.evaluate", {
                "expression": "JSON.stringify({title:document.title,url:location.href})",
                "returnByValue": True,
            })
            return json.loads(result["result"]["value"])
        except Exception:
            return {"title": "", "url": ""}

    async def get_ax_tree_text(self) -> str:
        """Fetch AX tree, label interactive elements [1]..[N], return compact text."""
        try:
            result = await self.send("Accessibility.getFullAXTree", None, timeout=15.0)
        except Exception as e:
            logger.warning(f"AX tree fetch failed: {e} — returning empty state")
            return "(AX tree unavailable — use screenshot() to see the page)"

        nodes = result.get("nodes", [])
        logger.info(f"[AX] Total nodes from CDP: {len(nodes)}")

        # ── Pass 1: label ALL interactive nodes in the full tree (no cap) ──
        self._element_map = {}
        self._element_names = {}
        counter = 1
        node_labels: dict[str, int] = {}

        for node in nodes:
            if node.get("ignored"):
                continue
            role = node.get("role", {}).get("value", "")
            if role not in _INTERACTIVE_ROLES:
                continue
            props = _parse_props(node.get("properties", []))
            if props.get("disabled"):
                continue
            backend_id = node.get("backendDOMNodeId")
            if not backend_id:
                continue
            node_labels[node["nodeId"]] = counter
            self._element_map[counter] = backend_id
            # Build human-readable name for debug logging
            name = (node.get("name", {}).get("value") or "").strip()
            desc = role
            if name:
                desc += f' "{name}"'
            if props.get("placeholder"):
                desc += f' (placeholder: "{props["placeholder"]}")'
            self._element_names[counter] = desc
            counter += 1

        # ── Pass 2: format output (scan all nodes, cap output lines) ──
        info = await self.get_page_info()
        lines = [f'Page: "{info["title"]}" ({info["url"]})', ""]

        # Input fields float to top — they are ALWAYS shown before other elements
        # so a buried search box never gets cut off by the cap.
        input_lines: list[str] = []     # textbox / searchbox / combobox / spinbutton
        other_lines: list[str] = []     # buttons, links, checkboxes, etc.
        content_lines: list[str] = []
        seen: set[str] = set()
        # Dedup: track how many times each (role, name) pair has appeared.
        # Repetitive identical elements (e.g. 38× "Save this item to a trip list")
        # push important inputs like search boxes past the cap.
        _MAX_PER_LABEL = 3
        label_counts: dict[str, int] = {}
        label_suppressed: dict[str, int] = {}  # label_key → suppressed count

        for node in nodes:
            nid = node["nodeId"]
            if nid in seen:
                continue
            seen.add(nid)
            if node.get("ignored"):
                continue

            role = node.get("role", {}).get("value", "")
            name = (node.get("name", {}).get("value") or "").strip()
            props = _parse_props(node.get("properties", []))

            if role in _INTERACTIVE_ROLES and nid in node_labels:
                label = node_labels[nid]
                parts = [f"[{label}] {role}"]
                if name:
                    parts.append(f'"{name}"')
                extras: list[str] = []
                # Show current value for input roles — critical for the model to
                # know whether a field is pre-filled (e.g. Google Flights auto-fill)
                if role in _INPUT_ROLES:
                    cur_val = (node.get("value", {}).get("value") or "").strip()
                    if cur_val:
                        extras.append(f'value: "{cur_val[:80]}"')
                if props.get("placeholder"):
                    extras.append(f'placeholder: "{props["placeholder"]}"')
                if props.get("checked") is not None:
                    extras.append("checked" if props["checked"] else "unchecked")
                if props.get("selected"):
                    extras.append("selected")
                if role == "link" and props.get("url"):
                    url_short = props["url"][:60]
                    extras.append(f"→ {url_short}")
                if extras:
                    parts.append(f"({', '.join(extras)})")
                line = " ".join(parts)

                # Dedup: skip identical-label elements beyond the cap, but count them
                label_key = f"{role}|{name}"
                label_counts[label_key] = label_counts.get(label_key, 0) + 1
                if label_counts[label_key] > _MAX_PER_LABEL:
                    label_suppressed[label_key] = label_suppressed.get(label_key, 0) + 1
                    continue

                # Float input roles to top section; everything else goes below
                if role in _INPUT_ROLES:
                    input_lines.append(line)
                else:
                    other_lines.append(line)

            elif role in _HEADING_ROLES and name and len(content_lines) < MAX_CONTENT_LINES:
                level = props.get("level", "")
                prefix = f"H{level}: " if level else "Heading: "
                content_lines.append(prefix + name)

            elif role in _TEXT_ROLES and name and len(name) > 30 and len(content_lines) < MAX_CONTENT_LINES:
                content_lines.append("  " + name[:200])

        # Append suppression summary lines (one per deduplicated label)
        for label_key, count in label_suppressed.items():
            role_part, name_part = label_key.split("|", 1)
            summary = f'  ... ({count} more {role_part} "{name_part}" not shown)'
            other_lines.append(summary)

        # Cap: inputs are always fully shown; trim other_lines to fill remaining budget
        budget = max(0, MAX_INTERACTIVE_LINES - len(input_lines))
        other_lines_shown = other_lines[:budget]

        total_raw = sum(label_counts.values())
        total_unique = len(label_counts)
        dedup_count = sum(label_suppressed.values())
        logger.info(
            f"[AX] {total_raw} raw elements, {total_unique} unique labels, "
            f"{dedup_count} deduped, {len(input_lines)} inputs + {len(other_lines_shown)} other shown"
        )
        # Log full element index map so we can trace model decisions in terminal
        for idx, ename in self._element_names.items():
            logger.info(f"[AX]   [{idx}] {ename}")

        if input_lines:
            lines.append("Input fields (fill these before clicking Search/Submit):")
            lines.extend(input_lines)
            lines.append("")

        if other_lines_shown:
            lines.append("Other interactive elements:")
            lines.extend(other_lines_shown)
            trimmed = len(other_lines) - len(other_lines_shown)
            if trimmed > 0:
                lines.append(f"  ... ({trimmed} more elements not shown — scroll to see more)")
        elif not input_lines:
            lines.append("(No labeled interactive elements — consider screenshot() or scroll())")

        if content_lines:
            lines.append("")
            lines.append("Content:")
            lines.extend(content_lines[:MAX_CONTENT_LINES])

        # Always include prices if visible — they are short static text that the AX
        # tree's len>30 filter silently drops, leaving the model blind to price data.
        price_lines = await self.get_price_lines()
        if price_lines:
            lines.append("")
            lines.append("Prices visible on page:")
            lines.extend(price_lines)

        return "\n".join(lines)

    async def get_screenshot_b64(self) -> str:
        result = await self.send("Page.captureScreenshot", {
            "format": "jpeg",
            "quality": 60,
            "optimizeForSpeed": True,
            "captureBeyondViewport": False,
        })
        return result.get("data", "")

    async def get_page_text(self) -> str:
        result = await self.send("Runtime.evaluate", {
            "expression": "document.body ? document.body.innerText : ''",
            "returnByValue": True,
        })
        return (result.get("result", {}).get("value") or "")[:5000]

    async def get_price_lines(self) -> list[str]:
        """Extract lines containing prices from page text — generic, no site-specific selectors.

        Prices (e.g. 'A$167', 'AUD 120', '$99') are short static text nodes filtered
        out by our AX tree's len>30 threshold, making the model blind to them.
        This extracts them directly from the rendered page text.
        """
        try:
            result = await self.send("Runtime.evaluate", {
                "expression": "document.body ? document.body.innerText : ''",
                "returnByValue": True,
            })
            text = (result.get("result", {}).get("value") or "")
        except Exception:
            return []

        # Match lines containing a price pattern: currency symbol/code + digits
        price_re = re.compile(
            r'(?:A\$|AU\$|AUD|USD|GBP|EUR|\$|£|€|¥|₹)\s*[\d,]+(?:\.\d{1,2})?'
            r'|[\d,]+(?:\.\d{1,2})?\s*(?:AUD|USD|GBP|EUR)',
            re.IGNORECASE,
        )
        seen: set[str] = set()
        results: list[str] = []
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line or len(line) > 200:
                continue
            if price_re.search(line) and line not in seen:
                seen.add(line)
                results.append(line)
                if len(results) >= 20:
                    break
        return results

    async def _detect_autocomplete_suggestions(self) -> list[str]:
        """Return up to 5 visible option/listitem names after a type_text action.

        Autocomplete dropdowns (Google Flights origin, Booking.com destination, etc.)
        expose their suggestions as AX nodes with role 'option' or 'listitem'.
        Including them in the type_text result ensures the executor MUST interact
        with them before moving on — no more 'brisbane21 feb' concatenations.
        """
        try:
            result = await self.send("Accessibility.getFullAXTree", None, timeout=8.0)
            nodes = result.get("nodes", [])
            suggestions: list[str] = []
            for node in nodes:
                if node.get("ignored"):
                    continue
                role = node.get("role", {}).get("value", "")
                if role in ("option", "listitem"):
                    name = (node.get("name", {}).get("value") or "").strip()
                    if name and len(name) > 2:
                        suggestions.append(name)
                        if len(suggestions) >= 5:
                            break
            return suggestions
        except Exception:
            return []

    # ── Actions ────────────────────────────────────────────────────────────

    async def _resolve_object(self, backend_node_id: int) -> str:
        result = await self.send("DOM.resolveNode", {"backendNodeId": backend_node_id})
        return result["object"]["objectId"]

    async def _element_center(self, backend_node_id: int) -> tuple[float, float]:
        """Get viewport center of element, scrolling it into view first."""
        obj_id = await self._resolve_object(backend_node_id)
        # Scroll into view
        await self.send("Runtime.callFunctionOn", {
            "objectId": obj_id,
            "functionDeclaration": "function(){this.scrollIntoView({block:'center',behavior:'instant'});}",
        })
        await asyncio.sleep(0.1)
        # Try DOM.getBoxModel first (works for non-scrolled-away elements)
        try:
            bm = await self.send("DOM.getBoxModel", {"backendNodeId": backend_node_id})
            quads = bm["model"]["border"]  # [x1,y1, x2,y2, x3,y3, x4,y4]
            xs, ys = quads[0::2], quads[1::2]
            cx, cy = sum(xs) / 4, sum(ys) / 4
            if cx > 0 and cy > 0:
                return cx, cy
        except Exception:
            pass
        # Fallback: getBoundingClientRect via JS
        r = await self.send("Runtime.callFunctionOn", {
            "objectId": obj_id,
            "functionDeclaration": (
                "function(){"
                "const r=this.getBoundingClientRect();"
                "return {x:r.left+r.width/2,y:r.top+r.height/2};}"
            ),
            "returnByValue": True,
        })
        pos = r.get("result", {}).get("value", {})
        return float(pos.get("x", 400)), float(pos.get("y", 300))

    async def action_click(self, index: int) -> str:
        backend_id = self._element_map.get(index)
        if not backend_id:
            return f"Error: element [{index}] not in current page state. Check available elements."
        elem_name = self._element_names.get(index, "unknown")
        logger.info(f"[click] Targeting [{index}] = {elem_name!r}")
        try:
            # Record URL before click so we can detect navigation
            pre_url = (await self.get_page_info()).get("url", "")

            x, y = await self._element_center(backend_id)
            for etype in ("mousePressed", "mouseReleased"):
                await self.send("Input.dispatchMouseEvent", {
                    "type": etype, "x": x, "y": y,
                    "button": "left", "clickCount": 1,
                })
            await asyncio.sleep(0.5)

            # If the click caused a page navigation, wait for the new page to load
            try:
                post_url = (await self.get_page_info()).get("url", "")
                if post_url and post_url != pre_url:
                    logger.info(f"[Click] Navigation detected: {pre_url} → {post_url}")
                    for _ in range(15):
                        r = await self.send("Runtime.evaluate", {
                            "expression": "document.readyState",
                            "returnByValue": True,
                        })
                        if r.get("result", {}).get("value") in ("complete", "interactive"):
                            break
                        await asyncio.sleep(0.3)
                    await asyncio.sleep(2.5)  # SPA hydration
                    await self.send("Accessibility.enable")
            except Exception:
                pass

            return f"Clicked [{index}] at ({x:.0f},{y:.0f})"
        except Exception as e:
            return f"Click [{index}] failed: {e}"

    async def action_type_text(self, index: int, text: str, submit: bool = False) -> str:
        backend_id = self._element_map.get(index)
        if not backend_id:
            return f"Error: element [{index}] not found."
        elem_name = self._element_names.get(index, "unknown")
        logger.info(f"[type_text] Targeting [{index}] = {elem_name!r} → text: '{text[:80]}'")
        try:
            obj_id = await self._resolve_object(backend_id)
            # Focus the real input element (handles <div role="combobox"> wrappers
            # that contain an inner <input>), then select all existing text so that
            # the subsequent insertText call replaces it entirely.
            await self.send("Runtime.callFunctionOn", {
                "objectId": obj_id,
                "functionDeclaration": """function() {
                    var el = (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA')
                        ? this
                        : (this.querySelector('input:not([type=hidden]),textarea') || this);
                    el.focus();
                    try { el.setSelectionRange(0, (el.value || '').length + 9999); }
                    catch(e) {
                        try {
                            var r = document.createRange();
                            r.selectNodeContents(el);
                            var s = window.getSelection();
                            s.removeAllRanges();
                            s.addRange(r);
                        } catch(e2) {}
                    }
                }""",
            })
            await asyncio.sleep(0.05)
            # insertText replaces the current selection (i.e. all existing text)
            await self.send("Input.insertText", {"text": text})
            # Fire input/change so React/Vue/Angular frameworks pick up the new value
            await self.send("Runtime.callFunctionOn", {
                "objectId": obj_id,
                "functionDeclaration": """function() {
                    var el = (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA')
                        ? this
                        : (this.querySelector('input:not([type=hidden]),textarea') || this);
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                }""",
            })
            if submit:
                await asyncio.sleep(0.1)
                # Dismiss any autocomplete/suggestion dropdown first (Escape),
                # then submit (Enter).  This prevents YouTube-style dropdowns from
                # intercepting the Enter key and selecting a suggestion instead.
                for etype in ("keyDown", "keyUp"):
                    await self.send("Input.dispatchKeyEvent", {
                        "type": etype, "key": "Escape", "code": "Escape",
                        "windowsVirtualKeyCode": 27,
                    })
                await asyncio.sleep(0.1)
                for etype in ("keyDown", "keyUp"):
                    await self.send("Input.dispatchKeyEvent", {
                        "type": etype, "key": "Enter", "code": "Enter",
                        "windowsVirtualKeyCode": 13,
                    })
                await asyncio.sleep(2.0)  # Wait for navigation after form submit
                return f"Typed '{text[:60]}' into [{index}] and pressed Enter"
            # Wait for autocomplete dropdowns to appear (Google Flights, Maps, etc.
            # typically render suggestions 200-500ms after input)
            await asyncio.sleep(0.8)
            # Check for autocomplete suggestions and embed them in the result.
            # This forces the executor to handle the dropdown before the next action
            # rather than ignoring the system prompt instruction.
            suggestions = await self._detect_autocomplete_suggestions()
            if suggestions:
                names = ", ".join(f'"{s[:60]}"' for s in suggestions[:3])
                return (
                    f"Typed '{text[:60]}' into [{index}]. "
                    f"AUTOCOMPLETE DROPDOWN appeared with suggestions: {names}. "
                    f"You MUST click the correct suggestion before moving to the next field."
                )
            return f"Typed '{text[:60]}' into [{index}]"
        except Exception as e:
            return f"Type into [{index}] failed: {e}"

    async def action_navigate(self, url: str) -> str:
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        try:
            await self.send("Page.navigate", {"url": url}, timeout=15.0)
            # Poll readyState
            for _ in range(30):
                try:
                    r = await self.send("Runtime.evaluate", {
                        "expression": "document.readyState",
                        "returnByValue": True,
                    })
                    if r.get("result", {}).get("value") in ("complete", "interactive"):
                        break
                except Exception:
                    pass
                await asyncio.sleep(0.4)
            # Extra wait for SPAs (React/Vue/Angular) to finish rendering their UI
            await asyncio.sleep(3.0)
            # Re-enable Accessibility domain after navigation so node IDs are fresh
            try:
                await self.send("Accessibility.enable")
            except Exception:
                pass
            return f"Navigated to {url}"
        except Exception as e:
            return f"Navigation failed: {e}"

    async def action_scroll(self, direction: str, amount: int = 500) -> str:
        dx = dy = 0
        if direction == "down":
            dy = amount
        elif direction == "up":
            dy = -amount
        elif direction == "right":
            dx = amount
        elif direction == "left":
            dx = -amount
        await self.send("Input.dispatchMouseEvent", {
            "type": "mouseWheel", "x": 640, "y": 400,
            "deltaX": dx, "deltaY": dy,
        })
        await asyncio.sleep(0.2)
        return f"Scrolled {direction} {amount}px"


# ─────────────────────────────────────────────────────────────────────────────
# Agent loop
# ─────────────────────────────────────────────────────────────────────────────

class CDPAgent:
    """AX-tree-first browser agent using OpenAI tool use. No Playwright, no browser-use."""

    def __init__(self, target_id: str, api_key: str | None = None):
        self.target_id = target_id
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self._session: CDPAgentSession | None = None
        self._pending_screenshot: str | None = None  # b64 jpeg to attach to next user msg

    async def run(
        self,
        instruction: str,
        step_callback: Callable | None = None,
        should_stop: Callable | None = None,
    ) -> str:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=self.api_key)

        self._session = CDPAgentSession(self.target_id)
        await self._session.connect()
        logger.info(f"[Agent] Connected to CDP target: {self.target_id}")
        logger.info(f"[Agent] Task: {instruction}")

        try:
            ax_tree = await self._session.get_ax_tree_text()
            logger.info(f"[Agent] Initial page state ({len(ax_tree)} chars):\n{ax_tree}")

            # ── Planner phase ──────────────────────────────────────────────────
            # One cheap call to produce an explicit numbered step list.
            # The plan is embedded in the first user message (always kept in the
            # context window) so the executor has a concrete checklist on every step.
            plan = await _plan_task(instruction, ax_tree, client)
            plan_block = (
                f"\n\nExecution plan — follow these steps in order:\n{plan}"
                if plan else ""
            )

            # Full message history (kept for reference, but API only receives a window)
            messages: list[dict] = [
                {"role": "system", "content": SYSTEM_PROMPT},
                # First user message includes the task + plan; always kept in context window
                {"role": "user", "content": f"Task: {instruction}{plan_block}\n\n{ax_tree}"},
            ]

            # Track consecutive error results to trigger per-step model escalation
            consecutive_failures = 0

            for step in range(MAX_STEPS):
                if should_stop and await should_stop():
                    raise InterruptedError("Agent stopped by user")

                # Sliding context window: always send system + original task message,
                # plus only the last CONTEXT_WINDOW_STEPS step-triplets
                # (each step = 3 messages: assistant + tool + user).
                # This prevents O(N²) token growth over long tasks.
                max_tail = CONTEXT_WINDOW_STEPS * 3
                if len(messages) > 2 + max_tail:
                    api_messages = [messages[0], messages[1]] + messages[-max_tail:]
                    logger.info(
                        f"[Agent] Context window: sending {len(api_messages)} messages "
                        f"(trimmed {len(messages) - len(api_messages)} older messages)"
                    )
                else:
                    api_messages = messages

                # Escalate to a stronger model if the executor has failed 2+ times running
                model_for_step = FALLBACK_MODEL if consecutive_failures >= 2 else AGENT_MODEL
                if model_for_step != AGENT_MODEL:
                    logger.info(
                        f"[Agent] Escalating to {model_for_step} "
                        f"(step escalation after {consecutive_failures} consecutive failures)"
                    )

                response = await client.chat.completions.create(
                    model=model_for_step,
                    messages=api_messages,
                    tools=TOOLS,
                    tool_choice="required",
                )
                assistant_msg = response.choices[0].message

                # Build serialisable assistant dict
                msg_dict: dict = {"role": "assistant", "content": assistant_msg.content}
                if assistant_msg.tool_calls:
                    msg_dict["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in assistant_msg.tool_calls
                    ]
                messages.append(msg_dict)

                # Log model reasoning (content before tool call) so we can see WHY it chose that action
                if assistant_msg.content:
                    logger.info(f"[Step {step+1}] Model reasoning: {assistant_msg.content[:800]}")

                if not assistant_msg.tool_calls:
                    # No tool call — treat content as done
                    logger.info(f"[Step {step+1}] No tool call in response, treating as done")
                    return assistant_msg.content or "Task completed"

                # Only execute the FIRST tool call. OpenAI requires a tool result for
                # every tool_call_id in the assistant message — append dummy results for
                # any extras to keep the message history valid.
                tc = assistant_msg.tool_calls[0]
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                # Annotate index-based actions with the element's human-readable name
                tool_args_display = dict(tool_args)
                if "index" in tool_args_display and self._session:
                    idx = tool_args_display["index"]
                    elem_name = self._session._element_names.get(idx, "?")
                    tool_args_display["_element"] = elem_name
                logger.info(f"[Step {step+1}] {tool_name}({tool_args_display})")

                # done() — verify result before accepting it
                if tool_name == "done":
                    result_text = tool_args.get("result", "Task completed")
                    logger.info(f"[Step {step+1}] DONE (proposed): {result_text}")

                    # Guard: if the result contains numbers (prices, counts, etc.),
                    # verify at least one appears in the actual page text.
                    # This prevents the model from hallucinating specific data it never saw.
                    nums_in_result = re.findall(r'\d[\d,\.]*', result_text)
                    if nums_in_result:
                        try:
                            page_text = await self._session.get_page_text()
                            verified = any(n in page_text for n in nums_in_result if len(n) >= 2)
                        except Exception:
                            verified = True  # Don't block on verification errors
                        if not verified:
                            logger.warning(
                                f"[Step {step+1}] done() REJECTED — result contains "
                                f"{nums_in_result[:3]} but none found in page text. "
                                f"Sending back to model."
                            )
                            # Return an error tool result so the model tries again
                            for call in assistant_msg.tool_calls:
                                messages.append({
                                    "role": "tool",
                                    "tool_call_id": call.id,
                                    "content": (
                                        f"REJECTED: Your result mentions {nums_in_result[:3]} "
                                        f"but these values are not visible on the current page. "
                                        f"Do not invent data. Use extract_text() to read the actual "
                                        f"page content before calling done()."
                                    ),
                                })
                            ax_tree = await self._session.get_ax_tree_text()
                            messages.append({"role": "user", "content": ax_tree})
                            continue  # back to top of loop

                    # Append tool result so message history stays valid
                    for call in assistant_msg.tool_calls:
                        messages.append({
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": result_text if call == tc else "skipped",
                        })
                    if step_callback:
                        await step_callback(step + 1, tool_name, tool_args, result_text)
                    return result_text

                # Execute the first tool
                tool_result = await self._execute_tool(tool_name, tool_args)
                tool_result_str = tool_result if isinstance(tool_result, str) else "[screenshot taken]"

                logger.info(f"[Step {step+1}] → {tool_result_str[:200]}")

                # Update failure counter for per-step model escalation
                if tool_result_str.lower().startswith("error") or "failed:" in tool_result_str.lower():
                    consecutive_failures += 1
                    logger.info(f"[Agent] Failure streak: {consecutive_failures}")
                else:
                    consecutive_failures = 0

                # Append tool results for ALL tool_calls in this assistant message.
                # OpenAI 400-errors if any tool_call_id is missing a corresponding tool message.
                for call in assistant_msg.tool_calls:
                    if call == tc:
                        messages.append({
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": tool_result_str,
                        })
                    else:
                        # Extra tool calls ignored — inform model to use one tool per step
                        messages.append({
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": "Skipped: only one tool call per step is allowed.",
                        })

                if step_callback:
                    await step_callback(step + 1, tool_name, tool_args, tool_result_str)

                # Build next user message (fresh page state ± screenshot)
                ax_tree = await self._session.get_ax_tree_text()
                logger.info(f"[Step {step+1}] Page state seen by model:\n{ax_tree}")
                if self._pending_screenshot:
                    next_content: Any = [
                        {"type": "text", "text": ax_tree},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{self._pending_screenshot}",
                                "detail": "low",
                            },
                        },
                    ]
                    self._pending_screenshot = None
                else:
                    next_content = ax_tree

                messages.append({"role": "user", "content": next_content})

            return "Max steps reached without completing the task"

        finally:
            await self._session.close()

    async def _execute_tool(self, name: str, args: dict) -> str:
        s = self._session
        if name == "click":
            return await s.action_click(args.get("index", 0))
        elif name == "type_text":
            return await s.action_type_text(args.get("index", 0), args.get("text", ""))
        elif name == "type_and_submit":
            return await s.action_type_text(args.get("index", 0), args.get("text", ""), submit=True)
        elif name == "navigate":
            return await s.action_navigate(args.get("url", ""))
        elif name == "scroll":
            return await s.action_scroll(args.get("direction", "down"), args.get("amount", 500))
        elif name == "screenshot":
            b64 = await s.get_screenshot_b64()
            self._pending_screenshot = b64
            return "Screenshot captured — shown in next page state"
        elif name == "extract_text":
            return await s.get_page_text()
        else:
            return f"Unknown tool: {name}"


# ─────────────────────────────────────────────────────────────────────────────
# Entry point (matches server.py interface)
# ─────────────────────────────────────────────────────────────────────────────

async def run_agent_task_streaming(
    instruction: str,
    target_id: str,
    api_key: str | None = None,
    step_callback: Callable | None = None,
    should_stop: Callable | None = None,
) -> str:
    agent = CDPAgent(target_id=target_id, api_key=api_key)
    return await agent.run(
        instruction,
        step_callback=step_callback,
        should_stop=should_stop,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_props(properties: list) -> dict:
    """Flatten AX node properties list into a simple dict."""
    out = {}
    for p in properties:
        val = p.get("value", {})
        out[p["name"]] = val.get("value")
    return out
