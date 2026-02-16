import os
import logging
from typing import Callable, Awaitable, Any

# Increase browser-use event timeouts for Electron CDP (must be set before import)
os.environ["TIMEOUT_BrowserStartEvent"] = "120"
os.environ["TIMEOUT_BrowserStateRequestEvent"] = "30"

from browser_use import Agent, BrowserSession
from browser_use import ChatOpenAI
from browser_use.agent.views import ActionResult
import asyncio

from backend.action_interceptor import try_fast_execute

logger = logging.getLogger(__name__)

# Persistent browser session connected to Anthracite's Electron via CDP
_browser_session: BrowserSession | None = None

# -- Agent configuration: be smart about cost, never compromise capability --
AGENT_MAX_STEPS = 100  # full capability — let the agent finish complex tasks
AGENT_MAX_ACTIONS_PER_STEP = 5  # default — don't restrict multi-action steps
AGENT_STEP_TIMEOUT = 180  # seconds per step — some pages are slow
AGENT_MAX_FAILURES = 3   # standard retries
# Only include DOM attributes the LLM actually needs (smart cost saving — no capability loss)
AGENT_INCLUDE_ATTRIBUTES = [
    "title", "aria-label", "placeholder", "alt", "name", "type", "href", "value",
    "role", "for", "action", "method", "target", "src",
]

# Extended system prompt for Anthracite-specific reliability
AGENT_SYSTEM_EXTENSION = """
## Anthracite Agent Rules
- Call the `done` action immediately when the task is complete. Do not continue browsing.
- If a cookie consent banner or popup appears, dismiss it first (click "Accept", "Close", or "X").
- If you are stuck or the page doesn't change after your action, try a different approach.
- Never repeat the same action more than twice. If it didn't work, try something else.
- Prefer clicking interactive elements by their visible text or aria-label.
- For search tasks: type the query and press Enter. Don't look for a search button.
- Be concise in your reasoning. Focus on the next action, not lengthy analysis.
"""


class AnthraciteAgent(Agent):
    """Agent subclass that intercepts simple actions for fast CDP execution."""

    def __init__(self, *args, target_id: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._anthracite_target_id = target_id

    async def _execute_actions(self) -> None:
        """Override to try fast CDP path for simple actions before falling back to normal."""
        if self.state.last_model_output is None:
            raise ValueError('No model output to execute actions from')

        actions = self.state.last_model_output.action

        # Try fast CDP execution for simple actions
        fast_result = await try_fast_execute(actions, self._anthracite_target_id)
        if fast_result is not None:
            self.state.last_result = fast_result
            # Invalidate browser-use's cached state so next step gets fresh DOM
            if self.browser_session:
                self.browser_session._cached_browser_state_summary = None
                self.browser_session._cached_selector_map.clear()
            return

        # Fall through to normal browser-use multi_act
        result = await self.multi_act(actions)
        self.state.last_result = result


def _patch_screenshot_for_electron():
    """Optimize browser-use screenshots for Electron.

    Replaces PNG with JPEG + optimizeForSpeed for faster CDP capture.
    Gracefully handles failures (e.g. webview targets where screenshots
    may not work) — returns None so the agent continues with DOM-only mode.
    """
    try:
        from browser_use.browser.watchdogs import screenshot_watchdog
        from cdp_use.cdp.page.commands import CaptureScreenshotParameters

        _original = screenshot_watchdog.ScreenshotWatchdog.on_ScreenshotEvent

        async def on_ScreenshotEvent(self, event):
            try:
                focused_target = self.browser_session.get_focused_target()
                if focused_target and focused_target.target_type == 'page':
                    target_id = focused_target.target_id
                else:
                    page_targets = self.browser_session.get_page_targets()
                    if not page_targets:
                        return None
                    target_id = page_targets[-1].target_id

                cdp_session = await self.browser_session.get_or_create_cdp_session(target_id, focus=True)
                params = CaptureScreenshotParameters(
                    format='jpeg',
                    quality=40,
                    optimizeForSpeed=True,
                    captureBeyondViewport=False,
                )

                # Wrap in timeout to prevent hanging if renderer is dead/black screen
                try:
                    result = await asyncio.wait_for(
                        cdp_session.cdp_client.send.Page.captureScreenshot(
                            params=params, session_id=cdp_session.session_id
                        ),
                        timeout=2.0  # Fail fast if renderer is stuck
                    )
                except asyncio.TimeoutError:
                    logger.warning("Screenshot capture timed out (renderer might be stuck)")
                    return None

                if result and 'data' in result:
                    return result['data']
                return None
            except Exception as e:
                logger.warning(f"Screenshot capture failed (continuing without vision): {e}")
                return None

        screenshot_watchdog.ScreenshotWatchdog.on_ScreenshotEvent = on_ScreenshotEvent
        logger.info("Patched screenshot handler: JPEG + optimizeForSpeed + graceful fallback + 2s timeout")
    except Exception as e:
        logger.warning(f"Failed to patch screenshot handler: {e}")


def _patch_session_for_electron():
    """Patch BrowserSession to avoid interfering with Electron's tab management."""
    try:
        from browser_use.browser.session import BrowserSession
        from browser_use.browser.events import SwitchTabEvent

        async def on_SwitchTabEvent(self, event: SwitchTabEvent):
            logger.info(f"Skipping SwitchTabEvent for Electron (target {event.target_id})")
            # We don't want browser-use to try to activate tabs via CDP, 
            # as Electron manages the UI focus.
            # We just update the internal focus state.
            self.agent_focus_target_id = event.target_id
            
        BrowserSession.on_SwitchTabEvent = on_SwitchTabEvent
        
        # Patch SessionManager to avoid activateTarget calls
        # Instead of patching SessionManager methods which is invasive,
        # we will patch the CdpConnection.send method to intercept Target.activateTarget commands.
        # This is robust because it catches ALL calls, even from internal methods we might miss.
        
        # from cdp_use.cdp.target import activateTarget  <-- REMOVED (caused import error)

        
        # We need to find where the client is created. 
        # It's created in BrowserSession._initialize_session -> await connect_cdp(self.cdp_url)
        # connect_cdp returns a CdpConnection.
        
        # Since we can't easily hook into the connection creation without modifying library code,
        # we will monkeypatch the BrowserSession.start method (or _initialize_session) to apply the hook
        # after connection is established.
        
        original_initialize = BrowserSession._initialize_session
        
        async def _initialize_session_patched(self):
            await original_initialize(self)
            
            if self._cdp_client_root:
                # The _cdp_client_root is a CdpClient. 
                # It has a .send property which returns a namespace.
                # It's hard to patch properties.
                # However, CdpClient uses a 'connection' (CdpConnection) internally?
                # No, CdpClient is a wrapper.
                
                # Let's check if we can patch the specific command function.
                # The command is cdp_client.send.Target.activateTarget.
                # This is likely a bound method or a functools.partial.
                
                # Let's try to patch the method on the class if possible, or instance.
                # cdp_use is generated code. 
                # cdp_use.cdp.target.Target matches the domain.
                
                # Let's use a dynamic proxy approach on the client root's send.Target object if possible.
                # But that's complicated.
                
                # SIMPLER APPROACH: 
                # Patch `browser_use.browser.session.BrowserSession.get_or_create_cdp_session`? 
                # No, that's not where activateTarget is called in SessionManager. Note: SessionManager uses `self.browser_session._cdp_client_root`.
                
                # Let's look at `SessionManager._recover_agent_focus` again.
                # It calls: await self.browser_session._cdp_client_root.send.Target.activateTarget(...)
                
                # We can monkeypatch `cdp_use.cdp.target.Target.activateTarget`?
                # If it's a class method or static method used by the client.
                # No, it's usually an instance method on a generated class.
                
                # Let's try to patch `SessionManager._recover_agent_focus` by REPLACING it with a copy 
                # that acts as a no-op for the activateTarget call.
                # Since we can't edit the code, we can define a new function that does mostly the same thing
                # OR just overrides it to do nothing safely?
                # No, recovery logic is important.
                
                # Let's go with the patch of `SessionManager._recover_agent_focus` but simply comment out the line in our copy.
                # This is effectively what I am doing below.
                pass

        # Since I cannot easily copy the complex logic of _recover_agent_focus, 
        # I will patch the `Target.activateTarget` at the library level if possible.
        
        # HACK: Monkeypatch the cdp_use library's activateTarget command generator?
        # browser-use uses `cdp_use`.
        # `cdp_client.send.Target.activateTarget` ultimately calls `connection.send("Target.activateTarget", params)`.
        
        # Let's try to intercept at the connection level!
        # BrowserSession has `_cdp_client_root`.
        # `_cdp_client_root` (CdpClient) has `_connection` (CdpConnection)?
        # Let's assume it does (standard pattern).
        
        async def _initialize_session_intercept(self):
            await original_initialize(self)
            if self._cdp_client_root:
                # Try to find the connection
                connection = getattr(self._cdp_client_root, '_connection', None)
                if connection:
                     # Patch connection.send
                    original_send = connection.send
                    
                    def patched_send(method, params=None, session_id=None):
                        if method == "Target.activateTarget":
                            logger.info(f"Interceptor: Dropping Target.activateTarget for {params}")
                            # Return a dummy future or result that resolves immediately
                            f = asyncio.get_running_loop().create_future()
                            f.set_result({})
                            return f
                        return original_send(method, params, session_id)
                        
                    connection.send = patched_send
                    logger.info("Successfully patched CDP connection to drop activateTarget")
                else:
                    logger.warning("Could not find _connection on cdp_client_root to patch")

        BrowserSession._initialize_session = _initialize_session_intercept

        logger.info("Patched BrowserSession: SwitchTabEvent is now no-op")
    except Exception as e:
        logger.warning(f"Failed to patch BrowserSession: {e}")


_patch_screenshot_for_electron()
_patch_session_for_electron()


async def get_or_create_session(cdp_url: str) -> BrowserSession:
    """Get existing browser session or create one connected to Anthracite via CDP."""
    global _browser_session

    if _browser_session is not None:
        return _browser_session

    _browser_session = BrowserSession(
        cdp_url=cdp_url,
        keep_alive=True,
        headless=False,  # Force headful mode so browser-use doesn't override viewport
        no_viewport=True,  # Let Electron manage the viewport size
        disable_security=True,  # Disable security checks (good for automation)
    )
    return _browser_session


async def _switch_to_agent_tab(session: BrowserSession, target_id: str | None = None):
    """Switch browser-use focus to the agent tab by target ID."""
    try:
        if target_id:
            logger.info(f"Switching agent focus to target: {target_id}")
            await session.get_or_create_cdp_session(target_id, focus=True)
            return

        # Fallback: find a non-UI tab
        state = await session.get_browser_state_summary()
        for tab in state.tabs:
            if tab.url != "http://127.0.0.1:5173/" and "devtools://" not in tab.url:
                logger.info(f"Switching agent focus to tab: {tab.url} (target: {tab.target_id})")
                await session.get_or_create_cdp_session(tab.target_id, focus=True)
                return
        logger.warning("No suitable agent tab found, using current focus")
    except Exception as e:
        logger.error(f"Failed to switch to agent tab: {e}")


async def run_agent_task_logic(instruction: str, cdp_url: str = "http://127.0.0.1:9222", target_id: str | None = None):
    """Run an agent task inside Anthracite's browser via CDP."""
    browser_session = await get_or_create_session(cdp_url)

    if browser_session._cdp_client_root is None:
        await browser_session.start()

    await _switch_to_agent_tab(browser_session, target_id)

    api_key = os.getenv("OPENAI_API_KEY")
    agent = AnthraciteAgent(
        task=instruction,
        llm=ChatOpenAI(model="gpt-4o", api_key=api_key),
        planner_llm=ChatOpenAI(model="gpt-4o-mini", api_key=api_key),
        browser_session=browser_session,
        use_vision='auto',
        max_actions_per_step=AGENT_MAX_ACTIONS_PER_STEP,
        max_failures=AGENT_MAX_FAILURES,
        step_timeout=AGENT_STEP_TIMEOUT,
        include_attributes=AGENT_INCLUDE_ATTRIBUTES,
        enable_planning=True,
        extend_system_message=AGENT_SYSTEM_EXTENSION,
        target_id=target_id,
    )

    result = await agent.run(max_steps=AGENT_MAX_STEPS)
    return result.final_result() or "Task Completed"


async def run_agent_task_streaming(
    instruction: str,
    cdp_url: str = "http://127.0.0.1:9222",
    target_id: str | None = None,
    step_callback: Callable[..., Awaitable[None]] | None = None,
    should_stop: Callable[..., Awaitable[bool]] | None = None,
):
    """Run an agent task with step-by-step streaming via callback."""
    browser_session = await get_or_create_session(cdp_url)

    if browser_session._cdp_client_root is None:
        await browser_session.start()

    await _switch_to_agent_tab(browser_session, target_id)

    api_key = os.getenv("OPENAI_API_KEY")
    agent = AnthraciteAgent(
        task=instruction,
        llm=ChatOpenAI(model="gpt-4o", api_key=api_key),
        planner_llm=ChatOpenAI(model="gpt-4o-mini", api_key=api_key),
        browser_session=browser_session,
        use_vision='auto',
        max_actions_per_step=AGENT_MAX_ACTIONS_PER_STEP,
        max_failures=AGENT_MAX_FAILURES,
        step_timeout=AGENT_STEP_TIMEOUT,
        include_attributes=AGENT_INCLUDE_ATTRIBUTES,
        enable_planning=True,
        extend_system_message=AGENT_SYSTEM_EXTENSION,
        register_new_step_callback=step_callback,
        register_should_stop_callback=should_stop,
        target_id=target_id,
    )

    result = await agent.run(max_steps=AGENT_MAX_STEPS)
    return result.final_result() or "Task Completed"


if __name__ == "__main__":
    asyncio.run(run_agent_task_logic("Go to google.com and search for 'Anthracite'"))
