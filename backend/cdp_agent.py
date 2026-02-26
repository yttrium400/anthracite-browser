"""Browser-use adapter for Anthracite.

Replaces the hand-rolled custom agent with browser-use + Claude Sonnet 4.6:
  - browser-use provides: merged DOM+AX+Snapshot tree (knows WHICH price belongs
    to WHICH hotel card), built-in memory/reflection/loop-detection, vision
  - Claude Sonnet 4.6: 72.5% computer-use benchmark, best-in-class for web tasks

Electron webview compatibility fix
-----------------------------------
browser-use only treats targets with target_type 'page'/'tab' as valid pages.
Electron's <webview> tags register as target_type 'webview', so we apply two
targeted fixes at session startup:
  1. Monkey-patch SessionManager.get_all_page_targets to include 'webview' —
     prevents browser-use from creating a spurious blank tab when it finds no
     'page' targets.
  2. After start(), re-type the specific target from 'webview' → 'page' and set
     agent_focus_target_id directly — no method-body patching required.

Public interface (unchanged for server.py compatibility):
  run_agent_task_streaming(instruction, target_id, api_key, step_callback, should_stop)
"""

import asyncio
import logging
import os

import aiohttp

logger = logging.getLogger(__name__)

CDP_PORT = 9222

# ─────────────────────────────────────────────────────────────────────────────
# One-time monkey-patch: make browser-use visible to Electron webview targets
# ─────────────────────────────────────────────────────────────────────────────

def _patch_browser_use_for_electron():
    """Extend SessionManager.get_all_page_targets to include 'webview' type.

    Applied once at module import time. Safe to call multiple times (idempotent).
    """
    try:
        from browser_use.browser.session_manager import SessionManager

        if getattr(SessionManager, "_anthracite_patched", False):
            return  # Already patched

        _orig = SessionManager.get_all_page_targets

        def _patched(self):
            return [
                t for t in self._targets.values()
                if t.target_type in ("page", "tab", "webview")
                # Exclude the Anthracite off-screen BrowserView marker tab —
                # it has a deliberately unique URL so we can reliably skip it.
                # browser-use would otherwise treat it as a stray tab and close it.
                and "browserview=1" not in t.url
            ]

        SessionManager.get_all_page_targets = _patched
        SessionManager._anthracite_patched = True
        logger.debug("[Patch] SessionManager.get_all_page_targets extended for Electron webviews")
    except Exception as e:
        logger.warning(f"[Patch] Could not patch browser-use for Electron webviews: {e}")


_patch_browser_use_for_electron()


# ─────────────────────────────────────────────────────────────────────────────
# One-time monkey-patch: fix screenshots for Electron webview targets
# ─────────────────────────────────────────────────────────────────────────────

def _patch_screenshot_for_electron():
    """Replace ScreenshotWatchdog.on_ScreenshotEvent with a direct-WebSocket version.

    Root cause: browser-use sends Page.captureScreenshot via the browser-level
    multiplexed session (cdp_use's 'flattened sessions' approach).  On Electron
    <webview> targets this command is routed correctly but the compositor never
    replies — the future hangs indefinitely, triggering bubus's 15-second event
    timeout every single step.

    Fix: open a *direct* WebSocket connection to the target's own debugger URL
    (ws://127.0.0.1:9222/devtools/page/<TARGET_ID>), send captureScreenshot
    there, and return the result.  Chromium supports multiple clients on the
    same target, so the existing AdBlockService connection is not displaced.
    A hard 5-second asyncio timeout guarantees we never block the agent.
    """
    try:
        from browser_use.browser.watchdogs.screenshot_watchdog import ScreenshotWatchdog
        from browser_use.browser.views import BrowserError

        if getattr(ScreenshotWatchdog, "_anthracite_patched", False):
            return

        async def on_ScreenshotEvent(self, event):  # noqa: N802
            import asyncio
            import json

            focused_target = self.browser_session.get_focused_target()
            if not focused_target:
                raise BrowserError("[Screenshot] No focused target")

            target_id = focused_target.target_id

            # ── Resolve the direct debugger WebSocket URL ─────────────────────
            try:
                async with aiohttp.ClientSession() as http:
                    async with http.get(
                        f"http://127.0.0.1:{CDP_PORT}/json",
                        timeout=aiohttp.ClientTimeout(total=3),
                    ) as resp:
                        targets = await resp.json(content_type=None)

                ws_url = next(
                    (t["webSocketDebuggerUrl"] for t in targets if t.get("id") == target_id),
                    None,
                )
                if not ws_url:
                    raise BrowserError(f"[Screenshot] No WS URL for {target_id[:12]}")
            except BrowserError:
                raise
            except Exception as e:
                raise BrowserError(f"[Screenshot] Target lookup failed: {e}")

            # ── Capture via direct WS with a hard 5-second timeout ────────────
            try:
                async with asyncio.timeout(5.0):
                    async with aiohttp.ClientSession() as http:
                        async with http.ws_connect(ws_url) as ws:
                            await ws.send_json({
                                "id": 1,
                                "method": "Page.captureScreenshot",
                                "params": {
                                    "format": "jpeg",
                                    "quality": 50,
                                    "captureBeyondViewport": False,
                                    "optimizeForSpeed": True,
                                },
                            })
                            async for msg in ws:
                                if msg.type == aiohttp.WSMsgType.TEXT:
                                    data = json.loads(msg.data)
                                    if data.get("id") == 1:
                                        if "result" in data:
                                            img = data["result"].get("data")
                                            if img:
                                                logger.info(
                                                    f"[Screenshot] Captured {len(img) // 1024}KB JPEG via direct WS"
                                                )
                                                return img
                                        elif "error" in data:
                                            raise BrowserError(
                                                f"[Screenshot] CDP error: {data['error'].get('message')}"
                                            )
                                elif msg.type in (
                                    aiohttp.WSMsgType.CLOSE,
                                    aiohttp.WSMsgType.ERROR,
                                ):
                                    raise BrowserError(f"[Screenshot] WS {msg.type.name}")
                            raise BrowserError("[Screenshot] WS closed without response")

            except asyncio.TimeoutError:
                raise BrowserError("[Screenshot] timed out after 5 s (direct WS)")
            except BrowserError:
                raise
            except Exception as e:
                raise BrowserError(f"[Screenshot] Direct WS failed: {e}")
            finally:
                try:
                    await self.browser_session.remove_highlights()
                except Exception:
                    pass

        ScreenshotWatchdog.on_ScreenshotEvent = on_ScreenshotEvent
        ScreenshotWatchdog._anthracite_patched = True
        logger.debug("[Patch] ScreenshotWatchdog replaced with direct-WS implementation")
    except Exception as e:
        logger.warning(f"[Patch] Could not patch ScreenshotWatchdog: {e}")


_patch_screenshot_for_electron()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _get_ws_url(target_id: str) -> str:
    """Resolve the WebSocket debugger URL for a specific CDP target."""
    async with aiohttp.ClientSession() as s:
        async with s.get(f"http://127.0.0.1:{CDP_PORT}/json") as resp:
            targets = await resp.json(content_type=None)
            for t in targets:
                if t.get("id") == target_id:
                    return t["webSocketDebuggerUrl"]
    raise ValueError(f"CDP target not found: {target_id}")


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

async def run_agent_task_streaming(
    instruction: str,
    target_id: str,
    api_key: str | None = None,
    anthropic_api_key: str | None = None,
    google_api_key: str | None = None,
    model: str | None = None,
    memory_prompt: str | None = None,
    step_callback=None,
    should_stop=None,
) -> str:
    """Run browser-use agent on the Electron webview identified by target_id.

    Args:
        instruction: Natural-language task description.
        target_id:   Chrome DevTools target ID of the active Electron webview.
        api_key:     OpenAI key passed from frontend (used as fallback only).
        step_callback: async fn(step_num, action_name, args_dict, result_str)
        should_stop:   async fn() -> bool  (called each step; True = abort)

    Returns:
        String result reported by the agent when done.
    """
    # ── Pick LLM ──────────────────────────────────────────────────────────────
    _anthropic_key = anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
    _openai_key = api_key or os.environ.get("OPENAI_API_KEY")
    _google_key = google_api_key or os.environ.get("GOOGLE_API_KEY")

    if model and model.startswith("claude-"):
        if not _anthropic_key:
            raise ValueError(f"Anthropic API key required for model '{model}'. Add it in Settings → Developer.")
        from browser_use.llm.anthropic.chat import ChatAnthropic
        llm = ChatAnthropic(model=model, api_key=_anthropic_key)
        logger.info(f"[Agent] Using {model} (Anthropic)")

    elif model and model.startswith("gpt-"):
        if not _openai_key:
            raise ValueError(f"OpenAI API key required for model '{model}'. Add it in Settings → Developer.")
        from browser_use.llm.openai.chat import ChatOpenAI
        llm = ChatOpenAI(model=model, api_key=_openai_key)
        logger.info(f"[Agent] Using {model} (OpenAI)")

    elif model and model.startswith("gemini-"):
        if not _google_key:
            raise ValueError(f"Google API key required for model '{model}'. Add it in Settings → Developer.")
        from langchain_google_genai import ChatGoogleGenerativeAI
        llm = ChatGoogleGenerativeAI(model=model, google_api_key=_google_key)
        logger.info(f"[Agent] Using {model} (Google AI)")

    elif model:
        # Ollama local model
        from langchain_community.chat_models import ChatOllama
        llm = ChatOllama(model=model, base_url="http://localhost:11434")
        logger.info(f"[Agent] Using {model} (Ollama local)")

    else:
        # Auto-select: Anthropic > OpenAI > Google
        if _anthropic_key:
            from browser_use.llm.anthropic.chat import ChatAnthropic
            llm = ChatAnthropic(model="claude-sonnet-4-6", api_key=_anthropic_key)
            logger.info("[Agent] Auto-selected Claude Sonnet 4.6 (Anthropic)")
        elif _openai_key:
            from browser_use.llm.openai.chat import ChatOpenAI
            llm = ChatOpenAI(model="gpt-4o", api_key=_openai_key)
            logger.info("[Agent] Auto-selected GPT-4o (OpenAI)")
        elif _google_key:
            from langchain_google_genai import ChatGoogleGenerativeAI
            llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=_google_key)
            logger.info("[Agent] Auto-selected Gemini 2.0 Flash (Google AI)")
        else:
            raise ValueError("No API key available. Add a key in Settings → Developer.")

    # ── Connect BrowserSession to Electron's CDP endpoint ────────────────────
    from browser_use import Agent, BrowserSession

    browser_session = BrowserSession(
        cdp_url=f"http://127.0.0.1:{CDP_PORT}",
        # Don't keep the browser alive between tasks — disconnect cleanly
        keep_alive=False,
        # Disable elements highlight overlay (not useful in our headless webview)
        highlight_elements=False,
    )

    # ── Adapt step_callback to browser-use's signature ───────────────────────
    # browser-use: callback(browser_state, agent_output, step_num: int)
    # ours:        callback(step_num, action_name, args_dict, result_str)
    # CAPTCHA page patterns — block the page from proceeding until user solves it.
    # We detect these by checking URL fragments and known CAPTCHA provider domains.
    _CAPTCHA_URL_PATTERNS = [
        "recaptcha",
        "hcaptcha.com",
        "challenges.cloudflare.com",
        "funcaptcha",
        "arkoselabs.com",
        "captcha.g.doubleclick",
        "cf-chl-bypass",
    ]

    # Login-page patterns that warrant takeover mode.
    # These are credential/password pages only — NOT OAuth consent screens.
    # OAuth consent flows (accounts.google.com/o/oauth2/...) don't need a password;
    # the agent can handle them automatically since the user is already logged in.
    _AUTH_URL_PATTERNS = [
        # Google: actual sign-in pages (not consent/oauth pages)
        "accounts.google.com/signin",
        "accounts.google.com/v3/signin",
        "accounts.google.com/ServiceLogin",
        # Microsoft: credential pages
        "login.microsoftonline.com",
        "login.live.com",
        # GitHub: login form
        "github.com/login",
        "github.com/session",
        # LinkedIn: login form
        "www.linkedin.com/login",
        "www.linkedin.com/checkpoint",
        # Amazon: sign-in
        "www.amazon.com/ap/signin",
        "amazon.com.au/ap/signin",
        "amazon.co.uk/ap/signin",
        # Apple ID
        "appleid.apple.com/sign-in",
        "appleid.apple.com/auth/authorize",
    ]

    def _detect_auth_service(url: str) -> str:
        if "google" in url:
            return "Google"
        if "github" in url:
            return "GitHub"
        if "linkedin" in url:
            return "LinkedIn"
        if "amazon" in url:
            return "Amazon"
        if "microsoft" in url or "live.com" in url or "microsoftonline" in url:
            return "Microsoft"
        if "apple" in url:
            return "Apple"
        return "the website"

    async def _get_live_target_ids() -> set[str]:
        """Return IDs of all real (non-blank) CDP targets visible to this Electron instance."""
        try:
            async with aiohttp.ClientSession() as sess:
                async with sess.get(f"http://127.0.0.1:{CDP_PORT}/json") as resp:
                    targets = await resp.json()
            return {
                t["id"] for t in targets
                if t.get("type") in ("webview", "page")
                and not t.get("url", "").startswith("about:")
            }
        except Exception:
            return set()

    # Mutable tracker so adapted_step_cb can update it via closure
    _target_tracker: dict = {"known": set()}

    adapted_step_cb = None
    if step_callback:
        async def adapted_step_cb(browser_state, agent_output, step_num: int):
            try:
                # Detect login/auth pages — emit auth_required and let server.py pause agent
                if browser_state and getattr(browser_state, "url", None):
                    current_url = browser_state.url

                    # CAPTCHA detection — pause and ask the user to solve it
                    if any(pat in current_url for pat in _CAPTCHA_URL_PATTERNS):
                        logger.info(f"[Takeover] CAPTCHA detected at {current_url[:80]} — pausing for user")
                        await step_callback(step_num, "captcha_required", {"url": current_url}, "")
                        return

                    # Auth page detection — pause for login takeover
                    if any(pat in current_url for pat in _AUTH_URL_PATTERNS):
                        service = _detect_auth_service(current_url)
                        logger.info(f"[Takeover] Auth page detected at {current_url[:80]} — pausing for {service}")
                        await step_callback(step_num, "auth_required", {"url": current_url, "service": service}, "")
                        return

                # ── New-tab following: switch agent focus to any tab opened since last step ──
                current_target_ids = await _get_live_target_ids()
                new_tab_ids = current_target_ids - _target_tracker["known"]
                _target_tracker["known"] = current_target_ids  # always update for next step
                if new_tab_ids:
                    new_tid = next(iter(new_tab_ids))
                    logger.info(f"[Agent] New tab detected: {new_tid[:12]}... — following")
                    # Re-type webview → page so browser-use accepts the target
                    if browser_session.session_manager:
                        for _tid, _tgt in browser_session.session_manager._targets.items():
                            if _tid == new_tid and _tgt.target_type == "webview":
                                _tgt.target_type = "page"
                                break
                    browser_session.agent_focus_target_id = new_tid
                    try:
                        _new_cdp = await browser_session.get_or_create_cdp_session(new_tid, focus=False)
                        await browser_session.session_manager._enable_page_monitoring(_new_cdp)
                    except Exception as _e:
                        logger.warning(f"[Agent] Could not set up new tab monitoring: {_e}")

                action_name = "thinking"
                args: dict = {}

                if agent_output and agent_output.action:
                    first = agent_output.action[0]
                    action_name = first.__class__.__name__
                    try:
                        args = first.model_dump(exclude_none=True)
                    except Exception:
                        args = {}

                goal = ""
                if agent_output and agent_output.current_state:
                    goal = agent_output.current_state.next_goal or ""

                await step_callback(step_num, action_name, args, goal)
            except Exception as e:
                logger.debug(f"[StepCallback] Error in adapter: {e}")

    # ── Adapt should_stop to browser-use's signature ─────────────────────────
    # browser-use: async fn() -> bool
    # ours:        async fn() -> bool  (same signature, just wrap it)
    adapted_stop_cb = None
    if should_stop:
        async def adapted_stop_cb() -> bool:
            return await should_stop()

    # ── Start session and fix Electron webview target type ───────────────────
    try:
        logger.info(f"[Agent] Connecting to CDP at http://127.0.0.1:{CDP_PORT}")
        await browser_session.start()

        # Fix: re-type webview → page so browser-use accepts the focus request.
        # Target is a plain Pydantic model (not frozen) so direct assignment works.
        if browser_session.session_manager:
            for tid, target in browser_session.session_manager._targets.items():
                if tid == target_id and target.target_type == "webview":
                    target.target_type = "page"
                    logger.info(
                        f"[Agent] Re-typed webview target {target_id[:12]}... as 'page'"
                    )
                    break

        # Set agent focus directly to our specific target.
        # agent_focus_target_id is a Pydantic field (not frozen), writable directly.
        # This bypasses the target_type guard in get_or_create_cdp_session
        # while still pointing all agent operations at the correct tab.
        browser_session.agent_focus_target_id = target_id
        logger.info(f"[Agent] Focus set to target {target_id[:12]}...")

        # Enable lifecycle events for our webview target.
        # browser-use's _handle_target_attached() only calls _enable_page_monitoring()
        # when target_type in ('page', 'tab'). Since Electron webviews register as
        # 'webview', lifecycle monitoring was silently skipped — causing browser-use
        # to fall back to a 4-second wall-clock timeout on every navigation instead
        # of the correct networkIdle signal. We call it manually here after re-typing.
        try:
            cdp_session = await browser_session.get_or_create_cdp_session(target_id, focus=False)
            await browser_session.session_manager._enable_page_monitoring(cdp_session)
            logger.info(f"[Agent] Lifecycle monitoring enabled for target {target_id[:12]}...")
        except Exception as e:
            logger.warning(f"[Agent] Could not enable lifecycle monitoring: {e}")

        # ── Run agent ─────────────────────────────────────────────────────────
        # Snapshot live targets so adapted_step_cb can detect new tabs opened mid-task
        _target_tracker["known"] = await _get_live_target_ids()

        # Build system message — prepend user memory if available
        _memory_block = (
            f"{memory_prompt}\n\n"
            if memory_prompt and memory_prompt.strip()
            else ""
        )

        agent = Agent(
            task=instruction,
            llm=llm,
            browser_session=browser_session,
            register_new_step_callback=adapted_step_cb,
            register_should_stop_callback=adapted_stop_cb,
            use_vision="auto",         # Screenshots only when LLM explicitly needs them (AX tree primary, like Comet)
            generate_gif=False,        # Don't save GIF, no output dir configured
            max_failures=5,
            max_actions_per_step=1,    # One action per step so agent sees autocomplete/state changes between actions
            use_judge=False,           # Disable post-run judge (saves 2 API calls, avoids false failures)
            extend_system_message=(_memory_block +
                "Site selection — navigate directly to the right site first:\n"
                "- Flights: https://www.google.com/flights\n"
                "- Hotels/accommodation: https://www.booking.com\n"
                "- Shopping: https://www.amazon.com.au\n"
                "- General search: https://www.google.com\n"
                "Do NOT use DuckDuckGo. Do not intentionally open new tabs — if clicking a link opens one automatically, you will be redirected there and should continue your task normally.\n"
                "\n"
                "Cookie banners and overlay popups:\n"
                "  When you encounter a cookie consent banner, GDPR notice, or modal overlay blocking\n"
                "  the page content, dismiss it FIRST before attempting any other action. Look for\n"
                "  buttons labelled 'Accept', 'Accept All', 'Accept Cookies', 'OK', 'Got it',\n"
                "  'Agree', 'I Accept', 'Allow All', or 'Close'. Click the most prominent one.\n"
                "  Similarly close newsletter sign-up popups or notification-permission prompts.\n"
                "  Only proceed to the main task once the page content is visible and unobstructed.\n"
                "\n"
                "Google Flights — follow this EXACT step order, no skipping:\n"
                "  Step 1. Navigate to https://www.google.com/flights (plain URL, no hash or query string).\n"
                "  Step 2. Change trip type to 'One way' BEFORE touching any other field.\n"
                "          Find the trip-type selector (shows 'Round trip' by default) near the top of the form.\n"
                "          Click it and select 'One way'. Confirm it now reads 'One way' before proceeding.\n"
                "  Step 3. Click 'Where from?', type the origin, then click the AIRPORT option\n"
                "          (e.g. 'Sydney Airport SYD'). Never click the generic city option — it opens a sub-menu.\n"
                "  Step 4. Click 'Where to?', type the destination, click the AIRPORT option.\n"
                "  Step 5. Click the Departure date field, select the date, click 'Done'.\n"
                "          In One-way mode 'Done' closes the calendar after one date — if it doesn't close,\n"
                "          the form is still in Round-trip mode; go back to Step 2.\n"
                "  Step 6. Click 'Search'.\n"
                "\n"
                "IMPORTANT: Step 2 is mandatory. If you skip it the calendar will require a return date\n"
                "and 'Done' / 'Search' will not work correctly.\n"
            ),
        )

        logger.info(f"[Agent] Starting task: {instruction}")
        try:
            # Hard per-task timeout: 5 minutes. Prevents stuck agents from running indefinitely.
            history = await asyncio.wait_for(agent.run(), timeout=300.0)
        except asyncio.TimeoutError:
            logger.warning("[Agent] Task timed out after 5 minutes")
            raise TimeoutError("Agent task timed out after 5 minutes. The task may be too complex — try breaking it into smaller steps.")

        result = history.final_result() or "Task completed"
        logger.info(f"[Agent] Done: {result[:200]}")
        return result

    except InterruptedError:
        raise  # Propagate stop signal to server.py
    except TimeoutError:
        raise  # Propagate timeout to server.py

    finally:
        try:
            await browser_session.stop()
        except Exception:
            pass  # Disconnect failures are non-fatal
