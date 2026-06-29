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
Browser (UI toggle "OMDb MCP server on")
  → POST /api/chat { useTools: true }
    → Express agent: Claude with tools          ← agentic tool-use loop
        ↕ stdio (MCP)
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
2. Open **Settings** (gear icon) and turn **Tools → OMDb MCP server** on.
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

| File             | Purpose                                                              |
| ---------------- | ------------------------------------------------------------------- |
| `omdb-server.ts` | The MCP server: exposes `search_movies` / `get_movie` over stdio.   |
| `omdb-client.ts` | Backend connector that spawns the server and is used by `/api/chat`. |

## Troubleshooting

- **`Missing OMDb API key`** — `OMDB_API_KEY` is not set in `.env`.
- **`Invalid API key!` in a tool result** — the key is wrong or not yet activated (check the
  activation email from OMDb).
