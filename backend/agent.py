import os
import logging

# Increase browser-use event timeouts for Electron CDP (must be set before import)
os.environ["TIMEOUT_BrowserStartEvent"] = "120"
os.environ["TIMEOUT_BrowserStateRequestEvent"] = "30"

from browser_use import Agent, BrowserSession
from browser_use import ChatOpenAI
import asyncio

logger = logging.getLogger(__name__)

# Persistent browser session connected to Poseidon's Electron via CDP
_browser_session: BrowserSession | None = None


def _patch_screenshot_for_electron():
    """Optimize browser-use screenshots for Electron.

    Replaces PNG with JPEG + optimizeForSpeed for faster CDP capture.
    BrowserViews are attached off-screen to the window (in main.ts) so they
    have a rendering surface and Page.captureScreenshot works via CDP.
    """
    try:
        from browser_use.browser.watchdogs import screenshot_watchdog
        from cdp_use.cdp.page.commands import CaptureScreenshotParameters

        _original = screenshot_watchdog.ScreenshotWatchdog.on_ScreenshotEvent

        async def on_ScreenshotEvent(self, event):
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

            result = await cdp_session.cdp_client.send.Page.captureScreenshot(
                params=params, session_id=cdp_session.session_id
            )
            if result and 'data' in result:
                return result['data']
            return None

        screenshot_watchdog.ScreenshotWatchdog.on_ScreenshotEvent = on_ScreenshotEvent
        logger.info("Patched screenshot handler: JPEG + optimizeForSpeed")
    except Exception as e:
        logger.warning(f"Failed to patch screenshot handler: {e}")


_patch_screenshot_for_electron()


async def get_or_create_session(cdp_url: str) -> BrowserSession:
    """Get existing browser session or create one connected to Poseidon via CDP."""
    global _browser_session

    if _browser_session is not None:
        return _browser_session

    _browser_session = BrowserSession(
        cdp_url=cdp_url,
        keep_alive=True,
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
    """Run an agent task inside Poseidon's browser via CDP."""
    browser_session = await get_or_create_session(cdp_url)

    if browser_session._cdp_client_root is None:
        await browser_session.start()

    await _switch_to_agent_tab(browser_session, target_id)

    agent = Agent(
        task=instruction + "\n\nIMPORTANT: As soon as the task is complete, immediately call the done action with a summary. Do not continue browsing or repeat actions.",
        llm=ChatOpenAI(model="gpt-4o", api_key=os.getenv("OPENAI_API_KEY")),
        browser_session=browser_session,
        use_vision='auto',
    )

    result = await agent.run()
    return result.final_result or "Task Completed"


if __name__ == "__main__":
    asyncio.run(run_agent_task_logic("Go to google.com and search for 'Poseidon'"))
