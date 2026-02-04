# Poseidon 🔱

The Open Source "Do It For Me" Browser.

AgentSurf is a desktop browser that replaces the URL bar with a Command Bar. Instead of navigating yourself, you tell the Agent what to do, and it drives the browser for you.

## Features
- **Command Bar Interface**: deeply integrated into the browser chrome.
- **Persistent Sessions**: Log in once, and the agent remembers you (uses `browser_profile` directory).
- **Stealth Mode**: Uses `browser-use` to mimic human behavior.
- **Local Privacy**: Your session data stays on your machine.

## Tech Stack
- **Frontend**: Electron, React, TypeScript, TailwindCSS.
- **Backend**: Python, FastAPI, `browser-use` library.

## Usage
1. Install dependencies: `npm install`
2. Setup Python: `python3 -m venv venv && source venv/bin/activate && pip install -r backend/requirements.txt && playwright install`
3. Add API Key: Edit `.env` and add your `OPENAI_API_KEY`.
4. Run: `npm run dev`
