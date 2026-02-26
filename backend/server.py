from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import importlib
import os
import json
import asyncio
import logging

from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

# Load .env from the project root (one level above backend/)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI()

if not any([os.environ.get("ANTHROPIC_API_KEY"), os.environ.get("OPENAI_API_KEY"), os.environ.get("GOOGLE_API_KEY")]):
    logger.warning("No API key found in environment. Keys can be configured in Settings → Developer.")



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
    api_key: str | None = None           # OpenAI key from frontend
    anthropic_api_key: str | None = None  # Anthropic key from frontend
    google_api_key: str | None = None     # Google AI key from frontend
    model: str | None = None              # Selected model ID (e.g. "claude-sonnet-4-6")
    memory_prompt: str | None = None      # User profile context injected into system prompt

class TestApiKeyRequest(BaseModel):
    api_key: str
    provider: str = "openai"  # "openai" | "anthropic" | "google"

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
        import backend.cdp_agent
        import backend.classifier
        logger.info("Backend warmup complete: Heavy modules loaded")
    except Exception as e:
        logger.error(f"Warmup failed: {e}")

@app.get("/")
def read_root():
    return {"status": "Anthracite Backend Running"}

@app.post("/agent/run")
async def run_agent(task: TaskRequest):
    # Determine API key source (Anthropic preferred, OpenAI fallback)
    api_key = task.api_key or os.environ.get("OPENAI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if not api_key and not anthropic_key:
        logger.error("No API key provided in request or environment")
        return {"status": "error", "message": "API key not found. Please add ANTHROPIC_API_KEY (or OpenAI key) in Settings."}

    # Temporarily set env var for the agent process if passed via request
    if task.api_key:
        os.environ["OPENAI_API_KEY"] = task.api_key

    if not task.target_id:
        return {"status": "error", "message": "No target_id provided."}
    try:
        from backend.cdp_agent import run_agent_task_streaming
        result = await run_agent_task_streaming(task.instruction, task.target_id, api_key=api_key)
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


@app.get("/providers")
async def get_providers():
    """Tell the frontend which providers have keys configured in the environment.

    The frontend merges this with any keys set in Settings — settings always win,
    but this ensures .env-only setups still populate the model selector.
    """
    return {
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "openai": bool(os.environ.get("OPENAI_API_KEY")),
        "google": bool(os.environ.get("GOOGLE_API_KEY")),
    }


@app.post("/test-api-key")
async def test_api_key(request: TestApiKeyRequest):
    """Test if an API key is valid by making a minimal call to the provider."""
    try:
        if request.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            llm = ChatAnthropic(model="claude-haiku-4-5-20251001", api_key=request.api_key, timeout=10)
        elif request.provider == "google":
            from langchain_google_genai import ChatGoogleGenerativeAI
            llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=request.api_key)
        else:  # openai
            from langchain_openai import ChatOpenAI
            llm = ChatOpenAI(model="gpt-4o-mini", api_key=request.api_key, timeout=10)

        await llm.ainvoke("hi")
        return {"status": "success", "valid": True}
    except Exception as e:
        logger.error(f"API key test failed ({request.provider}): {e}")
        return {"status": "error", "valid": False, "message": str(e)}


@app.get("/ollama/models")
async def get_ollama_models():
    """Probe the local Ollama server for available models."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get("http://localhost:11434/api/tags")
            data = response.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"available": True, "models": models}
    except Exception:
        return {"available": False, "models": []}


def _sse_event(data: dict) -> str:
    """Format a dict as an SSE event."""
    return f"data: {json.dumps(data)}\n\n"


@app.post("/agent/stream")
async def stream_agent(task: TaskRequest):
    """SSE streaming endpoint that classifies intent and routes accordingly.

    Fast path: direct CDP commands for simple actions (navigate, search).
    Complex path: full browser-use pipeline with step-by-step progress.
    """
    
    # Resolve keys: frontend value takes priority over env
    api_key = task.api_key or os.environ.get("OPENAI_API_KEY")
    anthropic_key = task.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
    google_key = task.google_api_key or os.environ.get("GOOGLE_API_KEY")

    if not api_key and not anthropic_key and not google_key:
        logger.error("Stream request rejected: No API key found")
        async def error_stream():
            yield _sse_event({"type": "error", "message": "No API key found. Add a key in Settings → Developer."})
        return StreamingResponse(error_stream(), media_type="text/event-stream")

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
            if intent.action == "fast_navigate":
                url = intent.params.get("url", "")
                # Tell the frontend the URL — it navigates via the proper IPC channel
                # (updates URL bar, history, webview). No CDP needed here.
                yield _sse_event({"type": "fast_action", "action": "navigate", "url": url})
                yield _sse_event({"type": "done", "result": f"Navigated to {url}"})

            else:
                # Complex path: custom CDP agent with AX-tree-first approach
                if not task.target_id:
                    yield _sse_event({"type": "error", "message": "No target_id provided for agent task."})
                    return

                agent_control.reset()
                yield _sse_event({"type": "agent_starting"})

                queue: asyncio.Queue = asyncio.Queue()

                async def step_callback(step_num, action, args, result):
                    """Push step info to the SSE queue (new CDP agent signature)."""
                    # Auth-required: pause the agent and notify the frontend for takeover mode
                    if action == "auth_required":
                        agent_control.pause()
                        await queue.put({
                            "type": "auth_required",
                            "step": step_num,
                            "url": args.get("url", ""),
                            "service": args.get("service", "the website"),
                        })
                        return

                    # CAPTCHA-required: pause the agent and prompt user to solve
                    if action == "captcha_required":
                        agent_control.pause()
                        await queue.put({
                            "type": "captcha_required",
                            "step": step_num,
                            "url": args.get("url", ""),
                        })
                        return

                    # Build a human-readable goal from the action and args
                    goal = args.get("text") or args.get("url") or args.get("result") or action
                    await queue.put({
                        "type": "step",
                        "step": step_num,
                        "next_goal": f"{action}: {goal}"[:120] if goal != action else action,
                        "actions": [{"action": action, **args}],
                    })

                # Run agent in background task
                async def run_agent():
                    try:
                        from backend.cdp_agent import run_agent_task_streaming
                        result = await run_agent_task_streaming(
                            task.instruction,
                            task.target_id,
                            api_key=api_key,
                            anthropic_api_key=anthropic_key,
                            google_api_key=google_key,
                            model=task.model,
                            memory_prompt=task.memory_prompt,
                            step_callback=step_callback,
                            should_stop=agent_control.should_stop,
                        )
                        await queue.put({"type": "done", "result": result})
                    except InterruptedError:
                        await queue.put({"type": "stopped", "result": "Agent stopped by user"})
                    except TimeoutError as e:
                        await queue.put({"type": "error", "message": str(e)})
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
