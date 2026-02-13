from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
# Lazy imports to speed up startup
# from backend.agent import run_agent_task_logic, run_agent_task_streaming
# from backend.classifier import classify
# from backend.cdp_fast import cdp_navigate
import importlib
import os
import json
import asyncio
import logging

from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

app = FastAPI()

if not os.environ.get("OPENAI_API_KEY"):
    logger.warning("OPENAI_API_KEY not found in environment. Agent features will be disabled.")


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
            })

            # Step 2: Route to fast path or complex path
            if intent.action == "fast_navigate" and task.target_id:
                url = intent.params.get("url", "")
                yield _sse_event({"type": "fast_action", "action": "navigate", "url": url})

                from backend.cdp_fast import cdp_navigate
                await cdp_navigate(task.target_id, url)

                yield _sse_event({"type": "done", "result": f"Navigated to {url}"})

            else:
                # Complex path: full browser-use with step streaming
                agent_control.reset()
                yield _sse_event({"type": "agent_starting"})

                queue: asyncio.Queue = asyncio.Queue()

                async def step_callback(browser_state, agent_output, step_num):
                    """Push step info to the SSE queue."""
                    actions_summary = []
                    try:
                        if agent_output and hasattr(agent_output, 'action'):
                            for a in agent_output.action:
                                # Extract just the action name and key params safely
                                action_dict = a.model_dump(exclude_none=True, mode='json')
                                actions_summary.append(action_dict)
                    except Exception:
                        # Fallback: just stringify action names
                        try:
                            if agent_output and hasattr(agent_output, 'action'):
                                for a in agent_output.action:
                                    actions_summary.append(str(type(a).__name__))
                        except Exception:
                            pass

                    await queue.put({
                        "type": "step",
                        "step": step_num,
                        "next_goal": getattr(agent_output, 'next_goal', None) if agent_output else None,
                        "actions": actions_summary,
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
                        event = await asyncio.wait_for(queue.get(), timeout=120.0)
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

if __name__ == "__main__":
    import uvicorn
    # When running as a PyInstaller bundle, we need to start the server explicitly.
    # We pass the 'app' object directly to avoid import string resolution issues in frozen mode.
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
