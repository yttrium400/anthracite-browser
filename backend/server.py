from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import importlib
import os
import json
import asyncio
import logging
import time

from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

app = FastAPI()

if not os.environ.get("OPENAI_API_KEY"):
    logger.warning("OPENAI_API_KEY not found in environment. Agent features will be disabled.")



class AgentControl:
    """Global agent control state for stop/pause/resume."""

    def __init__(self):
        self._stop_requested = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Not paused initially
        self._running = False

    def reset(self):
        self._stop_requested = False
        self._pause_event.set()
        self._running = True

    def stop(self):
        self._stop_requested = True
        self._pause_event.set()  # Unpause so the stop can take effect

    def pause(self):
        self._pause_event.clear()

    def resume(self):
        self._pause_event.set()

    @property
    def is_paused(self) -> bool:
        return not self._pause_event.is_set()

    @property
    def is_running(self) -> bool:
        return self._running

    async def should_stop(self) -> bool:
        # If paused, block here until resumed or stopped
        await self._pause_event.wait()
        return self._stop_requested

    def finish(self):
        self._running = False
        self._stop_requested = False
        self._pause_event.set()


agent_control = AgentControl()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TaskRequest(BaseModel):
    instruction: str
    cdp_url: str = "http://127.0.0.1:9222"
    target_id: str | None = None
    api_key: str | None = None  # Allow passing key from frontend

class TestApiKeyRequest(BaseModel):
    api_key: str

@app.on_event("startup")
async def startup_event():
    # Run warmup in background to avoid blocking startup
    asyncio.create_task(warmup())

async def warmup():
    """Import heavy modules in background after server starts."""
    logger.info("Warming up backend...")
    await asyncio.sleep(2)  # Short delay to prioritize UI responsiveness
    try:
        # Trigger lazy imports
        import backend.agent
        import backend.classifier
        import backend.cdp_fast
        logger.info("Backend warmup complete: Heavy modules loaded")
    except Exception as e:
        logger.error(f"Warmup failed: {e}")

@app.get("/")
def read_root():
    return {"status": "Anthracite Backend Running"}

@app.post("/agent/run")
async def run_agent(task: TaskRequest):
    # Determine API key source
    api_key = task.api_key or os.environ.get("OPENAI_API_KEY")
    
    if not api_key:
        logger.error("No API key provided in request or environment")
        return {"status": "error", "message": "OpenAI API key not found. Please add it in Settings."}
    
    # Temporarily set env var for the agent process if passed via request
    if task.api_key:
        os.environ["OPENAI_API_KEY"] = task.api_key

    try:
        from backend.agent import run_agent_task_logic
        result = await run_agent_task_logic(task.instruction, task.cdp_url, task.target_id)
        return {"status": "success", "result": result}
    except Exception as e:
        logger.error(f"Agent task failed: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


@app.post("/agent/stop")
async def stop_agent():
    agent_control.stop()
    return {"status": "ok", "message": "Stop requested"}


@app.post("/agent/pause")
async def pause_agent():
    agent_control.pause()
    return {"status": "ok", "paused": True}


@app.post("/agent/resume")
async def resume_agent():
    agent_control.resume()
    return {"status": "ok", "paused": False}


@app.get("/agent/status")
async def agent_status():
    return {
        "running": agent_control.is_running,
        "paused": agent_control.is_paused,
    }


@app.post("/test-api-key")
async def test_api_key(request: TestApiKeyRequest):
    """Test if an OpenAI API key is valid by making a minimal API call."""
    try:
        from langchain_openai import ChatOpenAI
        
        # Create a temporary LLM instance with the provided key
        llm = ChatOpenAI(
            model="gpt-4o-mini",
            api_key=request.api_key,
            timeout=10,
        )
        
        # Make a minimal test call
        result = await llm.ainvoke("test")
        
        return {"status": "success", "valid": True}
    except Exception as e:
        logger.error(f"API key test failed: {e}")
        return {"status": "error", "valid": False, "message": str(e)}


def _sse_event(data: dict) -> str:
    """Format a dict as an SSE event."""
    return f"data: {json.dumps(data)}\n\n"


@app.post("/agent/stream")
async def stream_agent(task: TaskRequest):
    """SSE streaming endpoint that classifies intent and routes accordingly.

    Fast path: direct CDP commands for simple actions (navigate, search).
    Complex path: full browser-use pipeline with step-by-step progress.
    """
    
    # Determine API key source
    api_key = task.api_key or os.environ.get("OPENAI_API_KEY")
    
    if not api_key:
        logger.error("Stream request rejected: No API key found")
        async def error_stream():
            yield _sse_event({"type": "error", "message": "OpenAI API key not found. Please add it in Settings."})
        return StreamingResponse(error_stream(), media_type="text/event-stream")
    
    # Set for this process scope
    if task.api_key:
        os.environ["OPENAI_API_KEY"] = task.api_key

    async def event_stream():
        try:
            # Step 1: Classify the intent
            yield _sse_event({"type": "classifying", "instruction": task.instruction})

            from backend.classifier import classify
            intent = await classify(task.instruction)
            
            yield _sse_event({
                "type": "classified",
                "action": intent.action,
                "params": intent.params,
                "classify_time_ms": round(intent.classify_time_ms, 1),
                "classify_method": intent.classify_method,
            })

            # Step 2: Route to fast path or complex path
            fast_handled = False
            if intent.action.startswith("fast_") and task.target_id:
                from backend.cdp_fast import cdp_navigate, cdp_scroll, cdp_go_back, cdp_go_forward, cdp_reload

                if intent.action == "fast_navigate":
                    url = intent.params.get("url", "")
                    yield _sse_event({"type": "fast_action", "action": "navigate", "url": url})
                    await cdp_navigate(task.target_id, url)
                    yield _sse_event({"type": "done", "result": f"Navigated to {url}"})
                    fast_handled = True

                elif intent.action == "fast_scroll":
                    direction = intent.params.get("direction", "down")
                    amount = intent.params.get("amount", 500)
                    yield _sse_event({"type": "fast_action", "action": "scroll", "direction": direction})
                    await cdp_scroll(task.target_id, direction, amount)
                    yield _sse_event({"type": "done", "result": f"Scrolled {direction}"})
                    fast_handled = True

                elif intent.action == "fast_back":
                    yield _sse_event({"type": "fast_action", "action": "back"})
                    await cdp_go_back(task.target_id)
                    yield _sse_event({"type": "done", "result": "Went back"})
                    fast_handled = True

                elif intent.action == "fast_forward":
                    yield _sse_event({"type": "fast_action", "action": "forward"})
                    await cdp_go_forward(task.target_id)
                    yield _sse_event({"type": "done", "result": "Went forward"})
                    fast_handled = True

                elif intent.action == "fast_reload":
                    yield _sse_event({"type": "fast_action", "action": "reload"})
                    await cdp_reload(task.target_id)
                    yield _sse_event({"type": "done", "result": "Page reloaded"})
                    fast_handled = True

            if not fast_handled:
                # Complex path: full browser-use with step streaming
                agent_control.reset()
                yield _sse_event({"type": "agent_starting"})

                queue: asyncio.Queue = asyncio.Queue()

                action_history = []  # Track all actions for loop visibility

                async def step_callback(browser_state, agent_output, step_num):
                    """Push step info to the SSE queue."""
                    actions_summary = []
                    try:
                        if agent_output and hasattr(agent_output, 'action'):
                            for a in agent_output.action:
                                action_dict = a.model_dump(exclude_none=True, mode='json')
                                actions_summary.append(action_dict)
                    except Exception:
                        try:
                            if agent_output and hasattr(agent_output, 'action'):
                                for a in agent_output.action:
                                    actions_summary.append(str(type(a).__name__))
                        except Exception:
                            pass

                    action_history.append({
                        "step": step_num,
                        "actions": actions_summary,
                    })

                    # Detect if we're potentially looping (same actions 2+ times)
                    is_potentially_looping = False
                    if len(action_history) >= 2:
                        prev = json.dumps(action_history[-2].get("actions", []), sort_keys=True)
                        curr = json.dumps(actions_summary, sort_keys=True)
                        is_potentially_looping = prev == curr

                    from backend.agent import AGENT_MAX_STEPS
                    await queue.put({
                        "type": "step",
                        "step": step_num,
                        "total_steps": AGENT_MAX_STEPS,
                        "next_goal": getattr(agent_output, 'next_goal', None) if agent_output else None,
                        "actions": actions_summary,
                        "is_potentially_looping": is_potentially_looping,
                    })

                # Run agent in background task
                async def run_agent():
                    try:
                        from backend.agent import run_agent_task_streaming
                        result = await run_agent_task_streaming(
                            task.instruction,
                            task.cdp_url,
                            task.target_id,
                            step_callback,
                            should_stop=agent_control.should_stop,
                        )
                        await queue.put({"type": "done", "result": result})
                    except InterruptedError:
                        await queue.put({"type": "stopped", "result": "Agent stopped by user"})
                    except Exception as e:
                        logger.error(f"Agent stream error in background task: {e}", exc_info=True)
                        await queue.put({"type": "error", "message": str(e)})
                    finally:
                        agent_control.finish()

                agent_task = asyncio.create_task(run_agent())

                # Stream events from queue until done
                while True:
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=300.0)
                        yield _sse_event(event)
                        if event["type"] in ("done", "error", "stopped"):
                            break
                    except asyncio.TimeoutError:
                        yield _sse_event({"type": "error", "message": "Agent timed out"})
                        agent_task.cancel()
                        break

                # Ensure agent task is cleaned up
                if not agent_task.done():
                    agent_task.cancel()
                    try:
                        await agent_task
                    except asyncio.CancelledError:
                        pass

        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
            yield _sse_event({"type": "error", "message": str(e)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")

@app.get("/benchmark")
async def benchmark():
    """Classifier benchmark: runs every instruction through BOTH regex and LLM,
    so you see side-by-side timing in a single run. No "before" snapshot needed.

    No browser needed — only tests classification speed.

    Usage: curl http://127.0.0.1:8000/benchmark | python3 -m json.tool
    """
    from backend.classifier import _try_regex_classify, _llm_classify, classify

    test_cases = [
        # Navigation — known sites
        "open youtube",
        "go to reddit",
        "gmail",
        "open google.com",
        "https://github.com/anthropics",
        "youtube.com",
        # Search
        "search for best laptops 2024",
        "google python tutorials",
        "what's the weather in tokyo",
        "how to make pasta",
        "restaurants near me",
        "define serendipity",
        "best headphones for running",
        "news",
        "python vs javascript",
        "translate hello to spanish",
        # Page actions
        "scroll down",
        "scroll to bottom",
        "go back",
        "refresh",
        # Complex (should be LLM only)
        "click the login button",
        "fill out the contact form",
        "add the first item to cart",
        "book a flight from SF to NYC next friday",
        "download the PDF on this page",
    ]

    results = []
    total_regex_ms = 0.0
    total_llm_ms = 0.0
    regex_hits = 0
    total_time_if_all_llm = 0.0

    for instruction in test_cases:
        # --- Regex path ---
        t0 = time.time()
        regex_result = _try_regex_classify(instruction)
        regex_ms = (time.time() - t0) * 1000

        # --- LLM path (always run to get comparison) ---
        t0 = time.time()
        llm_result = await _llm_classify(instruction)
        llm_ms = (time.time() - t0) * 1000

        # --- What our system actually uses ---
        if regex_result:
            actual_method = "regex"
            actual_action = regex_result.action
            actual_ms = regex_ms
            regex_hits += 1
            total_regex_ms += regex_ms
        else:
            actual_method = "llm"
            actual_action = llm_result.action
            actual_ms = llm_ms

        total_llm_ms += llm_ms  # track all LLM times for comparison
        total_time_if_all_llm += llm_ms

        results.append({
            "instruction": instruction,
            "actual_method": actual_method,
            "actual_action": actual_action,
            "actual_time_ms": round(actual_ms, 2),
            "regex_action": regex_result.action if regex_result else None,
            "regex_time_ms": round(regex_ms, 3),
            "llm_action": llm_result.action,
            "llm_time_ms": round(llm_ms, 1),
            "time_saved_ms": round(llm_ms - actual_ms, 1) if regex_result else 0,
        })

    total = len(test_cases)
    actual_total_ms = sum(r["actual_time_ms"] for r in results)

    return {
        "summary": {
            "total_tests": total,
            "regex_hits": regex_hits,
            "llm_fallbacks": total - regex_hits,
            "regex_hit_rate": f"{regex_hits / total * 100:.0f}%",
            "total_time_with_regex_ms": round(actual_total_ms, 1),
            "total_time_if_all_llm_ms": round(total_time_if_all_llm, 1),
            "time_saved_ms": round(total_time_if_all_llm - actual_total_ms, 1),
            "speedup": f"{total_time_if_all_llm / max(actual_total_ms, 0.01):.1f}x faster overall",
            "avg_regex_ms": round(total_regex_ms / max(regex_hits, 1), 3),
            "avg_llm_ms": round(total_llm_ms / total, 1),
            "cost_per_llm_call_usd": 0.0001,
            "cost_if_all_llm_usd": round(total * 0.0001, 4),
            "actual_cost_usd": round((total - regex_hits) * 0.0001, 4),
            "cost_saved_usd": round(regex_hits * 0.0001, 4),
        },
        "results": results,
    }


@app.get("/benchmark/cdp")
async def benchmark_cdp():
    """Run CDP speed benchmark. Requires Anthracite app running with at least one tab.

    Tests connection pool performance: first call (cold) vs subsequent calls (warm).

    Usage: curl http://127.0.0.1:8000/benchmark/cdp | python3 -m json.tool
    """
    import aiohttp

    # Find a target to test against
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://127.0.0.1:9222/json") as resp:
                targets = await resp.json()
    except Exception as e:
        return {"error": f"CDP not available: {e}. Is Anthracite running?"}

    # Find any page target that isn't the Anthracite UI, devtools, or about:blank
    page_targets = [t for t in targets if t.get("type") == "page"
                    and "devtools://" not in t.get("url", "")
                    and "127.0.0.1:5173" not in t.get("url", "")
                    and t.get("url", "") not in ("", "about:blank")]

    if not page_targets:
        # Fall back: navigate any about:blank tab to a test page first
        blank_targets = [t for t in targets if t.get("type") == "page"
                         and t.get("url", "") in ("", "about:blank")]
        if blank_targets:
            from backend.cdp_fast import cdp_navigate
            target_id = blank_targets[0]["id"]
            await cdp_navigate(target_id, "https://example.com")
            page_targets = [{"id": target_id, "url": "https://example.com"}]
        else:
            return {"error": "No browser tabs found. Open a tab in Anthracite first."}

    target_id = page_targets[0]["id"]
    target_url = page_targets[0].get("url", "unknown")

    from backend.cdp_fast import cdp_get_page_info, cdp_get_url, cdp_navigate, _pool, _pool_lock, _evict_stale_connections

    results = []

    try:
        # Clear pool safely through the lock
        async with _pool_lock:
            for tid in list(_pool.keys()):
                cdp_conn, _, _ = _pool.pop(tid)
                try:
                    await cdp_conn.close()
                except Exception:
                    pass

        # ── Part 1: CDP connection overhead ──────────────────────────────
        t0 = time.time()
        await cdp_get_url(target_id)
        cold_ms = (time.time() - t0) * 1000
        results.append({"test": "get_url (COLD — new WS connection)", "time_ms": round(cold_ms, 2)})

        t0 = time.time()
        await cdp_get_url(target_id)
        warm_ms = (time.time() - t0) * 1000
        results.append({"test": "get_url (WARM — reused connection)", "time_ms": round(warm_ms, 2)})

        # ── Part 2: Real navigation (what users actually feel) ───────────
        # Navigate to a real site and measure total time including page load
        t0 = time.time()
        await cdp_navigate(target_id, "https://www.google.com")
        nav_google_ms = (time.time() - t0) * 1000
        results.append({"test": "Navigate to google.com (REAL — includes page load)", "time_ms": round(nav_google_ms, 2)})

        # Navigate somewhere else
        t0 = time.time()
        await cdp_navigate(target_id, "https://example.com")
        nav_example_ms = (time.time() - t0) * 1000
        results.append({"test": "Navigate to example.com (REAL — includes page load)", "time_ms": round(nav_example_ms, 2)})

        # ── Part 3: End-to-end fast path (classify + execute) ────────────
        from backend.classifier import classify

        test_instructions = [
            "go to youtube",
            "open reddit",
            "search for best laptops 2024",
            "what is the weather in New York",
            "go back",
            "scroll down",
        ]

        e2e_results = []
        for instruction in test_instructions:
            t0 = time.time()
            intent = await classify(instruction)
            classify_ms = (time.time() - t0) * 1000

            t1 = time.time()
            if intent.action == "fast_navigate":
                await cdp_navigate(target_id, intent.params["url"])
            elif intent.action == "fast_back":
                from backend.cdp_fast import cdp_go_back
                await cdp_go_back(target_id)
            elif intent.action == "fast_scroll":
                # Skip scroll in benchmark (Electron BrowserView limitation)
                pass
            execute_ms = (time.time() - t1) * 1000
            total_ms = (time.time() - t0) * 1000

            e2e_results.append({
                "instruction": instruction,
                "action": intent.action,
                "classify_ms": round(classify_ms, 2),
                "execute_ms": round(execute_ms, 2),
                "total_ms": round(total_ms, 2),
                "method": intent.classify_method,
            })

        pool_speedup = cold_ms / max(warm_ms, 0.01)

        return {
            "target": {"id": target_id, "url": target_url},
            "pool_size": len(_pool),
            "connection_pool": {
                "cold_ms": round(cold_ms, 2),
                "warm_ms": round(warm_ms, 2),
                "speedup": f"{pool_speedup:.1f}x",
            },
            "real_navigations": results[2:],
            "end_to_end_fast_path": e2e_results,
            "summary": {
                "avg_fast_path_ms": round(sum(r["total_ms"] for r in e2e_results) / len(e2e_results), 2),
                "note": "Compare fast path total_ms against ~5-15s for full LLM agent pipeline per step",
            },
        }

    except Exception as e:
        logger.error(f"CDP benchmark error: {e}", exc_info=True)
        return {"error": str(e), "target_id": target_id, "target_url": target_url}


if __name__ == "__main__":
    import uvicorn
    # When running as a PyInstaller bundle, we need to start the server explicitly.
    # We pass the 'app' object directly to avoid import string resolution issues in frozen mode.
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
