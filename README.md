# Claude Chat

A streaming chat application powered by Claude via the Anthropic API. Built with a Node.js/Express backend and a React 19 frontend (TypeScript, bundled with esbuild).

## Features

- **Streaming responses** over SSE, with a live **stop/interrupt** button — interrupting keeps any partial output so you can correct or continue.
- **Conversation strategies** (selectable per chat in Settings):
  - *Default* — full history every request.
  - *Sliding Window* — only the last *N* Q&A pairs are sent.
  - *Sticky Facts* — key facts are extracted and pinned into the system prompt.
  - *Branching* — fork a conversation into parallel branches and compare them side by side.
- **Three-layer memory** — short-term (this dialog), working (this session/task), and long-term (global). All layers are injected into the system prompt.
- **Profiles** — reusable response styles applied globally to every dialog.
- **Invariants** — global hard constraints the assistant must check against and never violate.
- **Staged tasks** — run a task through a planning → execution → validation → done state machine, pausing for your review at each step.
- **Adjustable settings** — model, max tokens, temperature, and stop sequences.
- **Persistent history** — sessions, long-term memory, profiles, and invariants are stored on the server as JSON.

Most of these are driven by slash [commands](#commands).

## Prerequisites

- Node.js 24 LTS (see `.nvmrc` — run `nvm use`)
- pnpm 11+
- An [Anthropic API key](https://console.anthropic.com/)

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy the example environment file and add your API key:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `ANTHROPIC_API_KEY` to your key.

## Running

### Development (with hot reload)

```bash
pnpm dev
```

Starts the Express server with `tsx watch` and the esbuild client bundler in parallel. Open [http://localhost:3000](http://localhost:3000).

### Production

```bash
pnpm build
pnpm start
```

`pnpm build` compiles the TypeScript server (`tsc`) and bundles the React client (`esbuild`). `pnpm start` runs the compiled output.

Type-check the client without emitting with:

```bash
pnpm typecheck:client
```

## Project structure

```
src/
  server/
    index.ts            Express server: chat SSE proxy + JSON persistence
  client/
    index.tsx           React entry (mounts <App/>)
    App.tsx             Top-level layout
    useChat.ts          State + actions store (streaming, commands, tasks, sessions)
    components/         UI: Header, Sidebar, SettingsPanel, SidePanels,
                        TaskBar, BranchBar, Transcript, InputBar, CompareModal
    constants.ts        Commands, models, strategies, task stages
    markdown.ts         Minimal Markdown → HTML renderer
    format.ts           Date / strategy label helpers
    types.ts            Shared types
    index.html          HTML shell (mounts #root)
    style.css           Styles
data/                   Server-side JSON stores (gitignored)
```

The client is bundled by esbuild (`react`/`react-dom` 19); no separate framework or dev server is involved.

## Commands

Type these slash commands in the message input. They are handled locally in the browser and are **not** sent to Claude. Run `/help` in the app to see the same list.

### Memory layers

| Command | Description |
|---------|-------------|
| `/short-memory <text>` | Add to short-term memory (current dialog only, never persisted) |
| `/work-memory <text>` | Add to working memory (persists with the current session/task) |
| `/long-memory <text>` | Add to long-term memory (global, applied to every dialog) |

### Profiles

| Command | Description |
|---------|-------------|
| `/create-profile <name> <definition>` | Create and activate a response profile (style / format / limits) |
| `/profile` | Show the active profile |
| `/switch-profile <name>` | Switch the active profile |

### Invariants

| Command | Description |
|---------|-------------|
| `/add-invariant <text>` | Add a global hard constraint the assistant must never break |
| `/invariants` | List all invariants |

### Tasks

| Command | Description |
|---------|-------------|
| `/task <description>` | Run a staged task: planning → execution → validation → done. After each stage it pauses for review — reply to approve and continue, describe changes to revise, or type `стоп` to stop the task. |

### Other

| Command | Description |
|---------|-------------|
| `/help` | Show the list of all commands |

> While Claude is responding, the send button turns into a **stop** button — click it to interrupt the response (any partial output is kept).

## Environment variables

| Variable           | Default | Description              |
|--------------------|---------|--------------------------|
| `ANTHROPIC_API_KEY` | —       | Your Anthropic API key (required) |
| `PORT`             | `3000`  | Port the server listens on |
