# DSAgent VS Code Extension — Agent Guidelines

## Role of This Project
**dsagent-vscode** is the VS Code extension for DSAgent. It provides chat (native participant + custom panel), session management, variables explorer, artifacts view, notebook sync, and HITL. It **connects to a running DSAgent server** (`dsagent serve`, default `http://localhost:8000`). The extension does not run the agent; it is a client only.

## Project Structure
- **`src/`** — Extension host (TypeScript):
  - `extension.ts` — Activation: config, `DSAgentClient`, status bar, chat panel, tree providers, commands.
  - `api/client.ts` — HTTP/WebSocket client for DSAgent API; `api/types.ts` — request/response types.
  - `providers/` — `chatViewProvider.ts`, `chatParticipant.ts`, `sessionsTreeProvider.ts`, `variablesTreeProvider.ts`, `artifactsTreeProvider.ts`, `notebookController.ts`.
  - `services/` — `statusBar.ts`, `notebookSync.ts`.
  - `commands/` — Command registration and handlers.
- **`webview-ui/`** — Webview UI (React + Vite): chat input, messages, plan view, code blocks, execution results. Built output in `webview-ui/dist/`; extension loads it via `webview-ui/dist/index.html`.
- **`package.json`** — Defines commands, views, settings (`dsagent.serverUrl`, `dsagent.apiKey`, `dsagent.model`, `dsagent.hitlMode`, etc.), chat participant, and activation events.

## Prerequisites & Commands
- **Node 18+**, **npm**. VS Code 1.85+ for API compatibility.
- **Install:** `npm install` at repo root; `cd webview-ui && npm install` for the webview.
- **Build:** `npm run build` — builds webview then extension (esbuild). Or `npm run build:webview` then `node esbuild.js --production`.
- **Dev:** `npm run dev` — watch extension + webview (concurrently).
- **Lint:** `npm run lint` (ESLint on `src`).
- **Package:** `npm run package` (vsce) to produce `.vsix`.

## API Integration
- Extension uses **DSAgentClient** (`src/api/client.ts`) to talk to `dsagent serve`: REST for sessions, chat, kernel, artifacts, HITL; WebSocket for streaming where applicable.
- **Settings:** `dsagent.serverUrl` (default `http://localhost:8000`), `dsagent.apiKey` (if server has `DSAGENT_API_KEY`). Config changes trigger reconnect in `extension.ts`.
- Keep **`src/api/types.ts`** and client methods aligned with **dsagent**’s HTTP API (`docs/api/http-api.md` in the dsagent repo). Coordinate with **dsagent** and **dsagent-ui** when changing API contracts.

## Coding Conventions
- **Extension host:** TypeScript, VS Code API (`vscode`). Use `ExtensionContext.subscriptions` for disposables. Avoid blocking the host; do I/O in async/await or event-driven code.
- **Webview:** React in `webview-ui/src/`. Build with Vite; extension serves `webview-ui/dist/`. Message passing between host and webview via `postMessage` / `onDidReceiveMessage` as in existing providers.
- **Config:** Read with `vscode.workspace.getConfiguration('dsagent')`; react to changes with `vscode.workspace.onDidChangeConfiguration`.

## Testing & Debugging
- Use VS Code “Launch Extension” (e.g. `.vscode/launch.json`) to run the extension in a Development Host. Ensure **dsagent serve** is running so the extension can connect.
- After changing webview code, rebuild with `npm run build:webview` or use `npm run dev` for live rebuild during development.

## Quick Start for New Work
1. Start **dsagent serve** (from the **dsagent** project) on port 8000.
2. In **dsagent-vscode**: `npm install`, then `npm run build` or `npm run dev`.
3. Launch the extension from VS Code (Run and Debug → Launch Extension).
4. Open Chat with `@dsagent` or “DSAgent: Open Chat”; use Sessions/Variables/Artifacts views. For API or type changes, keep **dsagent** (and optionally **dsagent-ui**) in sync.
