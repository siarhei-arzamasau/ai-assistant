import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { StdioMcpClient } from './stdio-client.js';

/**
 * The MCP servers this app can connect to. Each entry maps a stable id (sent
 * from the UI) to a human label and the local server entry point that the
 * backend spawns over stdio.
 */
export const MCP_SERVERS = {
  omdb: { label: 'OMDb', entry: 'src/mcp/omdb-server.ts' },
  weather: { label: 'Weather', entry: 'src/mcp/weather-server.ts' },
  currency: { label: 'Currency', entry: 'src/mcp/currency-server.ts' },
} as const;

export type McpServerId = keyof typeof MCP_SERVERS;

export function isMcpServerId(id: string): id is McpServerId {
  return Object.prototype.hasOwnProperty.call(MCP_SERVERS, id);
}

// Lazily-created, reused client per server id. The child processes (and their
// schedulers) stay alive for the lifetime of the backend.
const clients = new Map<McpServerId, StdioMcpClient>();
const connecting = new Map<McpServerId, Promise<StdioMcpClient>>();

/** Get a connected MCP client for a server id, reusing an existing connection. */
export async function getMcpClient(id: McpServerId): Promise<StdioMcpClient> {
  const existing = clients.get(id);
  if (existing) return existing;

  let pending = connecting.get(id);
  if (!pending) {
    const server = MCP_SERVERS[id];
    const client = new StdioMcpClient({ name: `${id}-mcp-client`, entry: server.entry });
    pending = client
      .connect()
      .then(() => {
        clients.set(id, client);
        return client;
      })
      .catch((error) => {
        connecting.delete(id);
        throw error;
      });
    connecting.set(id, pending);
  }
  return pending;
}

export interface ConnectedToolset {
  /** Merged Anthropic tool definitions across all requested servers. */
  tools: { name: string; description?: string; input_schema: Tool['inputSchema'] }[];
  /** Routes a tool name to the client that owns it and its server label. */
  routeByTool: Map<string, { client: StdioMcpClient; serverLabel: string }>;
}

/**
 * Connect the requested MCP servers, list and merge their tools, and build a
 * routing map from tool name to the owning client. Unknown ids are ignored.
 */
export async function connectMcpServers(ids: string[]): Promise<ConnectedToolset> {
  const tools: ConnectedToolset['tools'] = [];
  const routeByTool: ConnectedToolset['routeByTool'] = new Map();

  for (const id of ids) {
    if (!isMcpServerId(id)) continue;
    const { label } = MCP_SERVERS[id];
    const client = await getMcpClient(id);
    for (const tool of await client.listTools()) {
      if (routeByTool.has(tool.name)) {
        console.warn(`[mcp] tool name collision for "${tool.name}" — overriding with ${label}`);
      }
      tools.push({ name: tool.name, description: tool.description, input_schema: tool.inputSchema });
      routeByTool.set(tool.name, { client, serverLabel: label });
    }
  }

  return { tools, routeByTool };
}
