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
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    openai_key = api_key or os.environ.get("OPENAI_API_KEY")

    if anthropic_key:
        from browser_use.llm.anthropic.chat import ChatAnthropic
        llm = ChatAnthropic(
            model="claude-sonnet-4-6",
            api_key=anthropic_key,
        )
        logger.info("[Agent] Using Claude Sonnet 4.6 (Anthropic)")
    elif openai_key:
        from browser_use.llm.openai.chat import ChatOpenAI
        llm = ChatOpenAI(
            model="gpt-4o",
            api_key=openai_key,
        )
        logger.info("[Agent] Using GPT-4o (OpenAI fallback — set ANTHROPIC_API_KEY for best results)")
    else:
        raise ValueError(
            "No API key available. Set ANTHROPIC_API_KEY in Settings or environment."
        )

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
    adapted_step_cb = None
    if step_callback:
        async def adapted_step_cb(browser_state, agent_output, step_num: int):
            try:
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
            extend_system_message=(
                "Site selection — navigate directly to the right site first:\n"
                "- Flights: https://www.google.com/flights\n"
                "- Hotels/accommodation: https://www.booking.com\n"
                "- Shopping: https://www.amazon.com.au\n"
                "- General search: https://www.google.com\n"
                "Do NOT use DuckDuckGo. Do NOT open new tabs.\n"
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
        history = await agent.run()

        result = history.final_result() or "Task completed"
        logger.info(f"[Agent] Done: {result[:200]}")
        return result

    except InterruptedError:
        raise  # Propagate stop signal to server.py

    finally:
        try:
            await browser_session.stop()
        except Exception:
            pass  # Disconnect failures are non-fatal
