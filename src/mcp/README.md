# GitHub MCP Client

A small [Model Context Protocol](https://modelcontextprotocol.io/) client that connects to
GitHub's hosted MCP server (`https://api.githubcopilot.com/mcp/`) over Streamable HTTP and lets
you discover and call GitHub tools — from the command line or your own code.

## Setup

1. **Create a GitHub Personal Access Token** at
   [github.com/settings/tokens](https://github.com/settings/tokens). Grant the scopes for the
   tools you intend to use (e.g. `repo` for repository/issue/PR access).

2. **Add it to your `.env`** at the project root:

   ```env
   GITHUB_PAT=your_github_pat_here
   ```

Dependencies are already installed (`@modelcontextprotocol/sdk`). No further setup needed.

## CLI usage

```
pnpm mcp list                    List every available tool
pnpm mcp describe <tool>         Show a tool's description and input schema
pnpm mcp call <tool> [args...]   Call a specific tool
pnpm mcp help                    Show usage
```

### Passing arguments to `call`

- `key=value` — a single argument. Values are parsed as JSON when possible
  (`perPage=2` → number, `draft=true` → boolean), otherwise treated as a string
  (`state=open` → `"open"`).
- `--json '<...>'` — pass the full argument object as a JSON string, for complex or nested input.

### Typical flow

```bash
# 1. Find a tool
pnpm mcp list

# 2. Inspect its required arguments
pnpm mcp describe list_issues

# 3. Call it
pnpm mcp call list_issues owner=siarhei-arzamasau repo=md-ai state=open
```

### Examples

```bash
# Authenticated user (no arguments)
pnpm mcp call get_me

# Search repositories (typed args: string + number)
pnpm mcp call search_repositories query="anthropic-sdk-typescript" perPage=2

# Read a file (nested/complex args via --json)
pnpm mcp call get_file_contents --json '{"owner":"o","repo":"r","path":"README.md"}'
```

## Programmatic usage

The CLI is built on the reusable `GitHubMcpClient` (`client.ts`). Use it directly in your own
code with the **connect → call → close** pattern:

```ts
import 'dotenv/config';
import { GitHubMcpClient } from './client.js';

const mcp = new GitHubMcpClient(); // reads GITHUB_PAT from env
await mcp.connect();

const tools = await mcp.listTools();

const result = await mcp.callTool('search_repositories', {
  query: 'user:siarhei-arzamasau',
});
// result.content is an array of blocks; text output lives on `text` blocks
for (const block of result.content) {
  if (block.type === 'text') console.log(block.text);
}

await mcp.close();
```

### Options

`new GitHubMcpClient(options)` accepts:

| Option    | Default                              | Description                                   |
| --------- | ------------------------------------ | --------------------------------------------- |
| `token`   | `process.env.GITHUB_PAT`             | GitHub PAT used as a Bearer credential.       |
| `url`     | `https://api.githubcopilot.com/mcp/` | MCP server URL.                               |
| `name`    | `github-mcp-client`                  | Client name sent during initialization.       |
| `version` | `1.0.0`                              | Client version sent during initialization.    |

### Scoping the toolset

The default endpoint exposes the full GitHub toolset (~50 tools). Narrow it via the `url` option
to reduce surface area or stay read-only:

```ts
new GitHubMcpClient({ url: 'https://api.githubcopilot.com/mcp/readonly' });
new GitHubMcpClient({ url: 'https://api.githubcopilot.com/mcp/x/repos' }); // single toolset
```

## Files

| File        | Purpose                                                        |
| ----------- | ------------------------------------------------------------- |
| `client.ts` | Reusable `GitHubMcpClient` wrapper around the MCP SDK.        |
| `cli.ts`    | Command-line interface (`list` / `describe` / `call`).        |
| `demo.ts`   | Minimal end-to-end example (`pnpm mcp:demo`).                 |

## Troubleshooting

- **`Missing GitHub token`** — `GITHUB_PAT` is not set in `.env` (or not passed via `{ token }`).
- **Empty / permission errors from a tool** — the PAT lacks the scope that tool requires; add the
  scope at [github.com/settings/tokens](https://github.com/settings/tokens).

---

# OMDb MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io/) **server** built on top of the
[OMDb API](https://www.omdbapi.com/). Unlike the GitHub client above (which talks to a remote
server), this is our own server: the chat agent connects to it over **stdio** and calls its tools to
search movies and fetch details — right from the chat UI.

```
Browser (Settings → MCP tools → [OMDb])
  → POST /api/chat { mcpServers: ["omdb"] }
    → Express agent: Claude with tools          ← agentic tool-use loop
        ↕ stdio (MCP), via the server registry
      omdb-server.ts (child process)  → OMDb API (www.omdbapi.com)
```

## Setup

1. **Get a free OMDb API key** at
   [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (activate it via the email link).

2. **Add it to your `.env`** at the project root:

   ```env
   OMDB_API_KEY=your_omdb_api_key_here
   ```

No extra dependencies — `@modelcontextprotocol/sdk` is already installed.

## Using it from the chat UI

1. Start the app: `pnpm dev` → open <http://localhost:3000>.
2. Open **Settings** (gear icon) and enable **MCP tools → OMDb**.
3. Ask the agent something it needs OMDb for, e.g.:
   - “Find movies about hackers”
   - “What’s the plot of The Matrix (1999)?”

   The agent calls the OMDb tools and each call appears as its own row in the transcript
   (tool name, arguments, and a collapsible result). Turn the toggle off for a normal chat.

## Tools

| Tool            | Arguments                                              | OMDb mapping                |
| --------------- | ------------------------------------------------------ | --------------------------- |
| `search_movies` | `query` (required), `type?`, `year?`, `page?`          | `s`, `type`, `y`, `page`    |
| `get_movie`     | `title?` **or** `imdbId?`, `year?`, `plot?`            | `t` / `i`, `y`, `plot`      |

## Running the server standalone

For debugging you can launch the server directly (it speaks JSON-RPC over stdio and waits for input):

```bash
pnpm mcp:omdb
```

## Files

| File             | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `omdb-server.ts` | The MCP server: exposes `search_movies` / `get_movie` over stdio. |

The backend connects to this server through the shared **server registry**
(`registry.ts` + `stdio-client.ts`) — see [Connecting MCP servers to the agent](#connecting-mcp-servers-to-the-agent).

## Troubleshooting

- **`Missing OMDb API key`** — `OMDB_API_KEY` is not set in `.env`.
- **`Invalid API key!` in a tool result** — the key is wrong or not yet activated (check the
  activation email from OMDb).

---

# Weather MCP Server (scheduled)

A local MCP **server** over the [weatherstack API](https://weatherstack.com/) with a built-in
**scheduler**. Beyond one-off lookups it can run jobs on a schedule, persist results to JSON, and
return aggregated summaries — covering deferred (reminders) and periodic (data collection) execution.

```
Browser (Settings → MCP tools → [Weather])
  → POST /api/chat { mcpServers: ["weather"] }
    → Express agent: Claude with tools
        ↕ stdio (MCP), via the server registry
      weather-server.ts (child process, lives as long as the backend)
        ├─ scheduler (setTimeout chains) + JSON store under data/weather/
        └─ weatherstack /current  (HTTP, free plan)
```

## Setup

1. **Get a free weatherstack API key** at [weatherstack.com](https://weatherstack.com/).
2. **Add it to your `.env`** at the project root:

   ```env
   WEATHERSTACK_API_KEY=your_weatherstack_api_key_here
   ```

## Using it from the chat UI

1. `pnpm dev` → open <http://localhost:3000>, open **Settings**, enable **MCP tools → Weather**.
2. Try, for example:
   - “Collect the weather in London every 30 seconds, 3 times” → starts a periodic collection job
     (intervals can be given in seconds and/or minutes).
   - “Give me a weather summary” → returns the aggregated result.
   - “Remind me in 2 minutes to take an umbrella” → schedules a one-off reminder;
     “show my reminders” lists the ones that have fired.

Scheduled jobs and collected data are written to `data/weather/` (gitignored) and **survive a backend
restart** — active jobs are resumed on startup (overdue runs fire right away).

## Tools

| Tool                          | Arguments                                          | What it does                                   |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `get_current_weather`         | `location`                                         | One-off current weather (not stored).          |
| `schedule_weather_collection` | `location`, `intervalSeconds` and/or `intervalMinutes`, `maxRuns?` | Periodic snapshots into JSON; first one now. |
| `schedule_reminder`           | `message`, `delaySeconds` and/or `delayMinutes`    | One-off deferred reminder.                     |
| `list_jobs`                   | —                                                  | All jobs with status / run count / next run.   |
| `cancel_job`                  | `jobId`                                            | Cancel an active job.                          |
| `get_weather_summary`         | `jobId?`, `location?`                              | Aggregated result over collected observations. |
| `list_due_reminders`          | —                                                  | Reminders that have already fired.             |

> **Free-plan quota:** weatherstack’s free tier allows only ~100 calls/month and is HTTP-only. Prefer
> large `intervalMinutes` and a small `maxRuns` so a collection job doesn’t exhaust your quota.

## Running the server standalone

```bash
pnpm mcp:weather
```

## Files

| File                  | Purpose                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `weather-server.ts`   | The MCP server: tools + scheduler + JSON persistence over stdio.             |
| `weather-aggregate.ts`| Pure `aggregateObservations()` used for `get_weather_summary` (unit-tested). |

## Troubleshooting

- **`Missing weatherstack API key`** — `WEATHERSTACK_API_KEY` is not set in `.env`.
- **Empty summaries** — no observations collected yet (the first snapshot is taken when the job
  starts; subsequent ones follow the interval).

---

# Currency MCP Server (scheduled)

A local MCP **server** over the [currencylayer API](https://currencylayer.com/) — the same scheduler
pattern as the Weather server, but for exchange rates: one-off lookups, periodic collection into JSON,
deferred reminders, and an aggregated per-pair summary.

```
Browser (Settings → MCP tools → [Currency])
  → POST /api/chat { mcpServers: ["currency"] }
    → Express agent: Claude with tools
        ↕ stdio (MCP), via the server registry
      currency-server.ts (child process, lives as long as the backend)
        ├─ scheduler (setTimeout chains) + JSON store under data/currency/
        └─ currencylayer /live  (HTTP, free plan: source = USD)
```

## Setup

1. **Get a free currencylayer API key** at [currencylayer.com](https://currencylayer.com/).
2. **Add it to your `.env`** at the project root:

   ```env
   CURRENCY_API_KEY=your_currencylayer_api_key_here
   ```

## Using it from the chat UI

1. `pnpm dev` → open <http://localhost:3000>, open **Settings**, enable **MCP tools → Currency**.
2. Try, for example:
   - “Collect USD→EUR and GBP rates every 30 seconds, 3 times” → starts a periodic collection job.
   - “Give me a summary of the collected rates” → aggregated per-pair result (min/max/avg, change).
   - “Remind me in 2 minutes to check the EUR rate” → schedules a one-off reminder.

Jobs and collected rates are written to `data/currency/` (gitignored) and **survive a backend
restart**. On the currencylayer free plan the base currency is **USD** only.

## Tools

| Tool                       | Arguments                                                                  | What it does                                   |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `get_live_rates`           | `currencies?`, `source?`                                                   | One-off live rates (not stored).               |
| `schedule_rate_collection` | `currencies`, `source?`, `intervalSeconds` and/or `intervalMinutes`, `maxRuns?` | Periodic snapshots into JSON; first one now. |
| `schedule_rate_reminder`   | `message`, `delaySeconds` and/or `delayMinutes`                            | One-off deferred reminder.                     |
| `list_rate_jobs`           | —                                                                          | All jobs with status / run count / next run.   |
| `cancel_rate_job`          | `jobId`                                                                    | Cancel an active job.                          |
| `get_rate_summary`         | `jobId?`, `currency?`                                                      | Aggregated per-pair result over observations.  |
| `list_due_rate_reminders`  | —                                                                          | Reminders that have already fired.             |

Tool names are distinct from the Weather server's, so both can be enabled at the same time without
collisions.

## Running the server standalone

```bash
pnpm mcp:currency
```

## Files

| File                    | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `currency-server.ts`    | The MCP server: tools + scheduler + JSON persistence over stdio.         |
| `currency-aggregate.ts` | Pure `aggregateRates()` used for `get_rate_summary` (unit-tested).       |

## Troubleshooting

- **`Missing currencylayer API key`** — `CURRENCY_API_KEY` is not set in `.env`.
- **`You have supplied an invalid Source Currency.`** — the free plan only supports `source=USD`.

---

# Connecting MCP servers to the agent

The local servers above are wired into the chat agent through a small **registry**:

| File              | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `stdio-client.ts` | Generic `StdioMcpClient` — spawns a TS MCP server via `tsx` and talks over stdio.  |
| `registry.ts`     | `MCP_SERVERS` map + lazy per-server singletons + `connectMcpServers(ids)`.         |

`POST /api/chat` accepts `mcpServers: string[]` (server ids enabled via the Settings toggles). For
each enabled id the registry connects the server, merges its tools, and routes each tool call back to
the owning server. The agent runs a tool-use loop, streaming `tool_use` / `tool_result` events to the
UI where each call is rendered as a `MCP · <server>` row.
