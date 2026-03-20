# Pilot

A conversational desktop app for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Pilot gives Claude direct access to execute terminal commands while keeping the experience conversational — like claude.ai but with execution capabilities.

Runs entirely on your existing Claude Pro/Max subscription. No API key needed.

## Download

**macOS (Apple Silicon):** [Download Pilot v1.0.1](https://github.com/pilotcodeapp/pilot/releases/latest)

Signed and notarized — opens without Gatekeeper warnings.

## Run from Source (Mac, Linux, Windows)

```bash
git clone https://github.com/pilotcodeapp/pilot.git
cd pilot
npm install
cd frontend && npm install && npm run build && cd ..
node backend/server.js
```

Then open [http://localhost:3001](http://localhost:3001).

### Requirements
- Node.js v20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Features

- **Streaming chat UI** — Claude's responses render word-by-word with full markdown, syntax highlighting, and code block copy
- **File tree panel** — project directory structure with read/created/edited badges; color-coded folders show activity at a glance
- **Live preview** — auto-detects localhost URLs, renders HTML/Markdown/images/PDF, and sandboxes JSX/TSX components
- **Dev server management** — auto-detects and starts `npm run dev`; preview panel points at the running server
- **Session persistence** — conversations saved and resumable across sessions
- **Activity log** — expandable timeline of Claude's tool calls and actions
- **Context meter** — shows Claude's context window usage
- **Dark/light mode** — auto-detects system preference
- **Mobile-responsive** — works on phones via the browser with swipe gestures, haptic feedback, and PWA support
- **Remote access** — optional Cloudflare tunnel integration with password authentication

## How It Works

Pilot spawns Claude Code as a subprocess using `--output-format stream-json` and communicates via stdin/stdout. The React frontend connects to the Express backend over WebSocket. No separate API key or billing — it uses your existing Claude Code authentication.

## Architecture

```
Electron shell (optional)
  └── Node/Express backend (localhost:3001)
        ├── WebSocket ↔ React frontend
        └── PTY/spawn ↔ Claude Code subprocess
```

- `backend/server.js` — Express server, WebSocket handler, Claude Code process management
- `frontend/src/` — React app (Vite), components in `src/components/`
- `electron/` — Electron wrapper for native Mac app
- `ios/` — SwiftUI iOS remote app (requires Xcode to build)

## Scripts

| Command | Description |
|---------|-------------|
| `node backend/server.js` | Start Pilot server (browser mode) |
| `npm start` | Launch Electron desktop app |
| `npm run build:mac` | Build signed DMG |
| `cd frontend && npm run build` | Rebuild frontend after changes |

## License

MIT
