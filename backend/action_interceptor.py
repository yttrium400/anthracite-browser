"""Fast CDP execution for simple LLM-decided actions.

When the LLM (or planner) decides on a simple, non-navigating action like scroll,
we can skip the full browser-use event bus pipeline and execute directly via
cdp_fast.py. This saves 1-3s per simple action.

IMPORTANT: Only truly "in-place" actions belong here. Actions that change the page
(navigate, go_back) MUST go through browser-use's event bus so that session
management, target focus tracking, and page-load events stay in sync.
"""

import logging
from typing import Any

from browser_use.agent.views import ActionResult

from backend.cdp_fast import cdp_scroll

logger = logging.getLogger(__name__)

# Only scroll is safe for the fast path — it doesn't change the page or
# require browser-use session coordination.
FAST_ACTIONS = {"scroll"}


async def try_fast_execute(
    actions: list[Any], target_id: str | None
) -> list[ActionResult] | None:
    """Try to execute actions via fast CDP path.

    Returns list of ActionResult if all actions were fast-eligible and executed,
    or None if any action isn't fast-eligible (caller should fall through to normal path).
    """
    if not target_id:
        return None

    # Check if ALL actions are fast-eligible
    action_entries = []
    for action in actions:
        action_data = action.model_dump(exclude_unset=True)
        action_name = next(iter(action_data.keys()), None)
        if action_name not in FAST_ACTIONS:
            return None
        action_params = action_data[action_name]
        action_entries.append((action_name, action_params))

    # All actions are fast-eligible — execute via CDP
    results = []
    for action_name, params in action_entries:
        try:
            result = await _execute_single(action_name, params, target_id)
            results.append(result)
        except Exception as e:
            logger.warning(f"Fast CDP execution failed for {action_name}: {e}")
            # Return None to fall through to normal path on any failure
            return None

    logger.info(f"⚡ Fast CDP path: executed {len(results)} action(s) via cdp_fast")
    return results


async def _execute_single(
    action_name: str, params: dict, target_id: str
) -> ActionResult:
    """Execute a single fast-eligible action via CDP."""
    if action_name == "scroll":
        direction = "down" if params.get("down", True) else "up"
        # Convert pages to pixel amount (roughly 600px per page)
        pages = params.get("pages", 1.0)
        amount = int(pages * 600)
        await cdp_scroll(target_id, direction=direction, amount=amount)
        return ActionResult(
            extracted_content=f"Scrolled {direction} {pages} page(s) [fast-cdp]"
        )

    raise ValueError(f"Unknown fast action: {action_name}")
