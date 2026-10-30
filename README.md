# Friday-pAI — Personal AI Desktop Assistant

Friday-pAI is an Electron desktop assistant with a React/Vite interface, an NVIDIA Nemotron-backed chat flow, Tavily web search, local tools, persistent memory/goals, and reusable workflow definitions.

## Requirements

- Node.js 20 or newer (Node.js 22 LTS recommended)
- npm
- API credentials configured locally for the integrations you use
- Node.js 22.5 or newer to run the Express backend, which uses Node's built-in SQLite module

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

   This installs dependencies for both the desktop app and the backend API.

2. Create a local `.env` file in the project root. Keep it private and never commit it. Add only the keys you actually use:

   ```env
   NVIDIA_API_KEY=your_nvidia_api_key
   TAVILY_API_KEY=your_tavily_api_key
   ```

3. Start the Vite renderer in one terminal:

   ```bash
   npm run dev
   ```

4. Start Electron in another terminal:

   ```bash
   npm run electron
   ```

The Electron main process loads its renderer from `http://localhost:5173`, so keep the Vite server running while testing the desktop app.

## Snabbler dashboard and REST backend

The Snabbler dashboard in `index.html` keeps its existing markup, design, theme, and navigation. It loads `src/dashboard-api.js` as its API controller; chat, memory, workflow, and history actions use the local Express API. SQLite stores dashboard memories, chat messages, workflow runs/events, goals, and tasks.

Start the backend from the project root in one terminal:

```bash
node server.js
```

Or use `npm run backend`. Start the frontend in a second terminal:

```bash
npm run dev
```

The backend binds only to `127.0.0.1`. It allows the Vite development origins on ports 5173/4173 and any additional comma-separated origins in `FRONTEND_URL`. It is intended for a single local user; the application does not currently implement login or multi-user accounts.

The default SQLite file is `backend/data/snabbler.sqlite`. On its first initialization, the backend imports repository-local `memory/memory.json`, `data/workflow-runs.json`, `data/task-events.json`, and `data/goals/goals.json` if present. It leaves the source files untouched and will not import them again after their migration markers are recorded. Electron's separate per-user `userData` JSON files remain managed by Electron and are not changed by the REST backend.

Copy the placeholder values from `.env.example` and `backend/.env.example` as needed. Set `NVIDIA_API_KEY` in the root `.env` or `backend/.env` for server-side chat and AI workflow steps. If both files define it, the root `.env` takes precedence. Restart the backend after changing the key. Keep the key out of frontend variables; only `VITE_API_BASE_URL` is read by the browser. `DATABASE_PATH` can optionally point to a different SQLite file. The database path and provider keys are never returned by API responses.

Available endpoints:

- `GET /api/health`
- `POST /api/chat`, `GET /api/chat/history`, `GET /api/conversations`, `GET /api/conversations/:id/messages`, and `DELETE /api/conversations/:id`
- `GET /api/memories`, `POST /api/memories`, `PUT /api/memories/:id`, `DELETE /api/memories/:id`
- `GET /api/goals`, `POST /api/goals`, `GET /api/goals/:id`, `PUT /api/goals/:id`, `DELETE /api/goals/:id`
- `POST /api/goals/:id/tasks`, `PATCH /api/goals/:id/tasks/:taskId`, `DELETE /api/goals/:id/tasks/:taskId`
- `GET /api/daily-plan`
- `GET /api/workflows`
- `POST /api/project-tools/preview` and `POST /api/project-tools/execute` for approved local project folder operations
- `POST /api/workflows/:id/runs`
- `GET /api/workflow-runs`, `GET /api/workflow-runs/:id`, `GET /api/workflow-runs/:id/events`
- `POST /api/workflow-runs/:id/approval`, `/resume`, and `/cancel`; `DELETE /api/workflow-runs/:id`

Chat calls the existing NVIDIA client and tool adapter from the backend. Conversations are stored separately, can be selected from the Jarvis Core right-side panel, and continue with their own context; existing chat messages are migrated into one conversation. Requests that need provider credentials fail explicitly when the key is not configured. Memory rejects recognizable credential patterns. Workflow file changes remain behind an approval step and use the project's secure file-operation helpers.

The React/Electron renderer in `src/App.jsx` is a separate existing app surface and is not mounted by the current Snabbler `index.html`; its Electron IPC and per-user JSON persistence remain unchanged.

## Workflow engine

Workflow definitions live in `workflows/*.json`. The desktop UI provides workflow discovery, typed input forms, execution status, per-step results/errors, approval controls, and persistent run history.

The engine and task recorder can be checked without calling external APIs:

```bash
npm test
npm run check:main
```

Build and lint the renderer/project with:

```bash
npm run build
npm run lint
```

The shipped workflows use existing tools and/or the configured AI/search integrations. `file-organizer` now builds a move preview and applies the proposed moves only after approval. It stays inside the selected project directory, skips common sensitive files and dependency/build folders, rejects symbolic links and path traversal, refuses overwrites, and attempts rollback if a move batch fails. `project-assistant` saves a Markdown review proposal under `.friday-proposals/` only after approval; it does not edit original source files.

## Privacy and safety

- Keep `.env` and API keys out of source control.
- Workflow project inspection avoids common sensitive files and redacts common key patterns.
- Approval-required workflow steps show their predecessor output as a preview and must be approved explicitly.
- File operations are confined to the chosen project directory; symbolic links, sensitive paths, path traversal and overwrites are rejected.
- Workflow runs, task events, memory, goals, and saved notes are stored locally under Electron's per-user `userData` directory in the desktop app. Existing project-local JSON data is migrated only when the destination does not already exist.
- The Memory screen lets you add, edit and delete facts. Recognizable credential patterns are rejected from saved memory.
- Tests use temporary directories so they do not erase your real run history, goals, or memory.

## Personal AI track direction

The project is being developed toward a private, user-controlled assistant with persistent memory, reusable workflows, and explicit access to tools. NVIDIA Nemotron is used through the existing NVIDIA API integration. Nebius Token Factory/AI Cloud usage and final hackathon packaging must be verified separately before submission; having a key alone is not proof of a successful inference integration.

## Persistent data and verification

The desktop app stores personal memory and workflow run/event history in Electron's per-user `userData` directory. On first launch, existing project-local JSON data is copied only when the destination does not already exist. Workflow memory retrieval uses local BM25 ranking plus sparse word/character vectors, concept expansion, category relevance, and recency. It works offline without sending saved memories to an embedding service, but it is not a neural dense-embedding model. Shipped workflows have deterministic checks for configured output conditions. File-changing steps remain behind explicit approval; file moves and generated artifacts use per-run idempotency protections where possible. A workflow can be cancelled between tool steps, although an already-running external call may finish before cancellation takes effect.

Run automated checks with:

```bash
npm test
npm run check:main
npm run lint
npm run build
```

The memory test launches a separate Node process to verify disk persistence. After installing dependencies on Windows, also launch the Electron app and restart it manually to validate the complete packaged runtime and live API integrations.

## Verification and smoke tests

On Windows PowerShell, from this project directory, run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\verify-windows.ps1
```

This performs a clean `npm ci`, automated workflow/memory/history/security/goals/provider tests, main-process syntax checks, ESLint, Vite production build, and optional live API smoke tests. The API smoke test reads `NVIDIA_API_KEY` and `TAVILY_API_KEY` from the process environment or a local `.env` file, never prints the keys, and skips any provider without a configured key. Do not commit `.env`.

To run only the API checks after configuring `.env`:

```powershell
npm run test:api-smoke
```

The automated persistence tests launch a separate Node process to confirm that memory and workflow history survive process restarts. Also perform a full GUI restart check on Windows: run a workflow, close Friday-pAI completely, relaunch it, and verify Memory and workflow history are still visible. A process-level test cannot substitute for validating the packaged Electron GUI on the target machine.
