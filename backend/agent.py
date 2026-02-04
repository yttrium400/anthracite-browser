from datetime import datetime
from browser_use import Agent, Controller
# from langchain_openai import ChatOpenAI # causing provider error
from browser_use import ChatOpenAI
import asyncio
import os

controller = Controller()

async def run_agent_task_logic(instruction: str):
    agent = Agent(
        task=instruction,
        llm=ChatOpenAI(model="gpt-4o", api_key=os.getenv("OPENAI_API_KEY")),
        controller=controller,
    )
    
    result = await agent.run()
    return result.final_result or "Task Completed"

if __name__ == "__main__":
    # Test run
    asyncio.run(run_agent_task_logic("Go to google.com and search for 'Poseidon'"))
