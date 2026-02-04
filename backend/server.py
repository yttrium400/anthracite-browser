from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from backend.agent import run_agent_task_logic
import os

app = FastAPI()

class TaskRequest(BaseModel):
    instruction: str

@app.get("/")
def read_root():
    return {"status": "Poseidon Backend Running"}

@app.post("/agent/run")
async def run_agent(task: TaskRequest):
    if not os.environ.get("OPENAI_API_KEY"):
        return {"status": "error", "message": "OPENAI_API_KEY not found in environment"}
    
    try:
        result = await run_agent_task_logic(task.instruction)
        return {"status": "success", "result": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}
