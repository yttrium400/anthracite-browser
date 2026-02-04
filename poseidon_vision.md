# Poseidon Vision & Requirements 🔱

## 1. Core Philosophy
Poseidon is designed to be the "Immaculate Agent Browser". It combines the best UI paradigms of modern browsers (Arc's verticality) with the power of autonomous agents, while strictly adhering to privacy and speed.

## 2. Key Pillars

### ⚡ Performance & Efficiency
- **Fast**: The browser must be lightweight. Electron app bundle size and RAM usage must be optimized.
- **Token Efficiency**: The Agent (Python backend) must use efficient prompting to minimize token costs for the user.

### 🎨 Immaculate UI/UX
- **Vertical Tabs**: Sidebar navigation similar to Arc (as requested).
- **Glassmorphism**: High-end, "premium" feel.
- **Unique Value**: Address Arc's pain points (stability, windows performance) and add "Agent Integration" as a first-class citizen, not an afterthought.

### 🛡️ Privacy & Security
- **No Ads**: Built-in "Brave-style" ad-blocking.
    - *Tech*: `@cliqz/adblocker-electron` or `electron-ad-block`.
- **Local Data**: All cookies/sessions stay in the `browser_profile` directory.
- **No Leaks**: Strict data handling. The Agent only sees what you explicitly allow.

### 🤖 Agent Intelligence
- **Captcha Bypass**: Must handle auth flows.
    - *Tech*: Integration with `2captcha` or `capsolver` services (user provided keys).
- **Persistent Auth**: "Login once, stay logged in" (Human-in-the-loop for initial auth).

## 3. Technical Requirements

### Stack
- **Frontend**: Electron + React + TailwindCSS (Shadcn/UI).
- **Backend**: Python FastAPI + `browser-use` (Playwright).
- **Communication**: HTTP/WebSocket.

### Specific Features to Build
1.  **Native Ad-Blocker**: Block requests at the network level in Electron.
2.  **Captcha Handler**: UI to input 2Captcha/CapSolver API keys.
3.  **Task Memory**: `tasks.json` (Already implemented) to track Agent objectives.
4.  **Sidebar UI**: Replicate the collapsible vertical tab interface.

## 4. Workflows

### The "Agent" Workflow
1.  User types "Audit my AWS bill" in Command Bar.
2.  Agent checks `tasks.json` for context.
3.  Agent launches/activates the browser view.
4.  Agent bypasses simple captchas if configured.
5.  Agent performs task and reports back.

### The "Human" Workflow
1.  User clicks "Manual Mode".
2.  Agent pauses.
3.  User browses normally (with Ad-block on).
4.  User solves complex MFA/Login tasks.
