# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A streaming chat application powered by Claude via the Anthropic API. Node.js/Express backend, React 19 frontend (TypeScript, bundled with esbuild, no framework/dev-server). The backend is also an MCP *client* (agentic tool-use loop) that can talk to local MCP servers bundled in this repo, plus a CLI MCP client for GitHub's hosted server.

## Commands

```bash
pnpm dev                 # server (tsx watch) + client (esbuild --watch) in parallel, http://localhost:3000
pnpm build                # tsc (server) + esbuild (client) + copy static assets -> dist/
pnpm start                 # run compiled server (dist/server/index.js)

pnpm test                  # vitest run (single run)
pnpm test:watch            # vitest watch
pnpm vitest run test/server/api.test.ts   # single test file
pnpm vitest run -t "name"                 # single test by name

pnpm test:e2e               # playwright (builds+serves the app itself on :3100, mocks /api/chat)
pnpm test:e2e:ui

pnpm lint / pnpm lint:fix
pnpm typecheck:client       # tsc -p tsconfig.client.json (noEmit)
pnpm typecheck:mcp          # tsc -p tsconfig.mcp.json (noEmit)
# note: there is no single "typecheck all" script — server type errors surface via `pnpm build:server` (tsc -p tsconfig.server.json)

pnpm mcp <list|describe|call>   # GitHub MCP CLI client
pnpm mcp:demo / mcp:omdb / mcp:weather / mcp:currency   # run a local MCP server standalone (stdio, for debugging)
```

There are **three separate tsconfigs** for one `src/` tree — server (`commonjs`, emits to `dist/`), client (`bundler` resolution, `noEmit`, includes only `src/client`), and mcp (`nodenext`, `noEmit`, includes only `src/mcp`). When editing shared code or adding new server-side files, check which tsconfig(s) it needs to type-check under.

## Architecture

### Server (`src/server/index.ts`) — one file, no router split

All Express routes, JSON-file persistence, and the `/api/chat` SSE endpoint live in this single ~500-line file. Persistence is flat JSON files under `DATA_DIR` (defaults to `data/`, gitignored; tests override `DATA_DIR` to a temp dir via Supertest so they never touch real data):

- `chat-history.json` — sessions (messages, strategy, sliding-window size, sticky facts, branches, working memory)
- `long-term-memory.json`, `profiles.json`, `invariants.json`

**`POST /api/chat`** is the core: it streams Claude's response over SSE (`text/event-stream`) and runs an **agentic tool-use loop** (up to `MAX_TOOL_ITERATIONS = 8`) when `mcpServers` is non-empty — each iteration streams a turn, and if `stop_reason === 'tool_use'` it executes the requested tools via the MCP registry and feeds `tool_result` blocks back in before looping again. Interrupting the client connection (`res.on('close')`) aborts the upstream Anthropic stream immediately rather than waiting it out. Model selection is allowlisted (`ALLOWED_MODELS`); Opus disables `temperature`; Haiku disables `thinking`.

Fact extraction (`POST /api/sessions/:id/extract-facts`, used by the *sticky-facts* strategy) makes a separate one-shot Haiku call that maintains a key-value JSON store of facts per session.

### Client (`src/client/`) — single custom store, no Redux/Zustand

`useChat.ts` is the entire state layer: one `useRef<Store>` mutated in place, with a `render()` bump (`setVersion`) after each mutation to trigger a re-render. There is no reducer/dispatch pattern — actions are plain functions closing over the store ref, returned from a `useMemo` and exposed as `{ s: Store, a: ChatActions }` to `App.tsx`. When adding new state, add a field to `Store`/`initialStore()` and a plain mutator function, following the existing style — don't introduce a different state pattern.

Key flows inside `useChat.ts`:
- `sendMessage()` — POSTs to `/api/chat`, manually parses the SSE stream (`data: {...}\n\n` lines) handling `text`, `thinking`, `tool_use`, `tool_result`, `usage`, `error`, `[DONE]`.
- `buildSystemPrompt()` — assembles the system prompt from, in order: invariants, active profile, sticky facts (if strategy active), short/working/long-term memory.
- Slash commands are parsed client-side only (`COMMAND_REGEX` in `constants.ts`) and **never sent to Claude** — `send()` dispatches to the matching handler (`handleMemoryCommand`, `handleProfileCommand`, `handleInvariantCommand`, `handleTaskCommand`, `/help`).
- **Task FSM** (`/task <description>`): a 4-stage state machine (`planning → execution → validation → done`, see `TASK_STAGES`/`TASK_STAGE_LABELS` in `constants.ts`). Each stage sends one message with stage-specific `extraSystem` instructions and pauses for user review; the reply is classified as approval (advance stage), a stop word, or feedback (regenerate the current stage) via regex in `isApproval`/`isStopWord`. Task state (`activeTask`) is intentionally never persisted to a session.
- **Branching**: forking a conversation duplicates `history` into named `BranchData` entries; `openCompare()` finds the common prefix (`forkIdx`) across branches for the side-by-side compare view.
- Four **conversation strategies** (`default`, `sliding-window`, `sticky-facts`, `branching`) are mutually exclusive, selected via `setStrategy`, and change both what's sent to `/api/chat` (`apiMessages()`) and what's persisted.

### MCP layer (`src/mcp/`)

Two distinct MCP roles coexist in this directory — don't conflate them:

1. **Remote client** (`client.ts` + `cli.ts` + `demo.ts`) — connects out to GitHub's hosted MCP server over Streamable HTTP using `GITHUB_PAT`. Standalone CLI tool, not wired into the chat agent.
2. **Local servers + registry** (everything else) — `omdb-server.ts`, `weather-server.ts`, `currency-server.ts` are standalone MCP servers speaking stdio, each runnable independently (`pnpm mcp:omdb` etc.) or spawned as child processes by the backend. `registry.ts` (`MCP_SERVERS` map) + `stdio-client.ts` (`StdioMcpClient`, generic stdio transport spawning a server via `tsx`) are what `src/server/index.ts` uses to connect servers requested by the UI (`mcpServers: string[]` in the `/api/chat` body), merge their tools, and route each `tool_use` call back to the owning server. Client singletons are lazily created and reused for the backend's lifetime.

The weather and currency servers additionally implement a **scheduler** (`setTimeout` chains + JSON persistence under `data/weather/` and `data/currency/`) supporting periodic collection jobs and deferred reminders that survive a backend restart (resumed on startup, overdue runs fire immediately). Their pure aggregation logic (`weather-aggregate.ts` / `currency-aggregate.ts`) is factored out specifically so it's unit-testable without spinning up the stdio server.

Adding a new local MCP server means: implement it as a standalone stdio server file, register it in `MCP_SERVERS` in `registry.ts`, add a `pnpm mcp:<name>` script in `package.json`, and add the required API key to `.env.example`. See `src/mcp/README.md` for the full per-server design writeups (protocol diagrams, tool tables, troubleshooting) — read it before touching this directory.

## Testing notes

- Vitest defaults to the `node` environment; component tests opt into `jsdom` per-file with a `// @vitest-environment jsdom` docblock (don't set it globally — most tests are pure-logic/backend and don't need a DOM).
- Backend tests (`test/server/api.test.ts`) drive the exported Express `app` directly via Supertest; `VITEST` env var being set is what keeps `src/server/index.ts` from calling `app.listen()` during tests.
- Playwright e2e builds and serves the real app on port 3100 and mocks `/api/chat` — it doesn't hit the Anthropic API.
