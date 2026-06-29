import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface OmdbMcpClientOptions {
  /** Client name reported to the server during initialization. */
  name?: string;
  /** Client version reported to the server during initialization. */
  version?: string;
}

/** Absolute path to the local `tsx` binary used to run the TypeScript server. */
const TSX_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
/** Path to the OMDb MCP server entry, relative to the project root. */
const SERVER_ENTRY = path.join('src', 'mcp', 'omdb-server.ts');

/**
 * A thin wrapper around the official MCP SDK `Client` that spawns the local
 * OMDb MCP server (`omdb-server.ts`) as a child process and talks to it over
 * stdio. The server reads `OMDB_API_KEY` from the inherited environment.
 */
export class OmdbMcpClient {
  private readonly client: Client;
  private readonly transport: StdioClientTransport;
  private connected = false;

  constructor(options: OmdbMcpClientOptions = {}) {
    this.transport = new StdioClientTransport({
      command: TSX_BIN,
      args: [SERVER_ENTRY],
      // Pass the current environment through so OMDB_API_KEY reaches the server.
      env: process.env as Record<string, string>,
    });

    this.client = new Client(
      {
        name: options.name ?? 'omdb-mcp-client',
        version: options.version ?? '1.0.0',
      },
      { capabilities: {} },
    );
  }

  /** Open the connection (spawning the server) and run the MCP handshake. */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }

  /** List every tool the OMDb MCP server exposes. */
  async listTools(): Promise<Tool[]> {
    this.assertConnected();
    const { tools } = await this.client.listTools();
    return tools;
  }

  /** Invoke a tool by name with the given arguments. */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<CallToolResult> {
    this.assertConnected();
    return (await this.client.callTool({
      name,
      arguments: args,
    })) as CallToolResult;
  }

  /** Close the transport and terminate the child process. */
  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error('OmdbMcpClient is not connected. Call connect() first.');
    }
  }
}

let singleton: OmdbMcpClient | null = null;
let connecting: Promise<OmdbMcpClient> | null = null;

/**
 * Lazily create and connect a shared OMDb MCP client. The child process and
 * connection are reused across requests; concurrent callers await the same
 * in-flight connection instead of spawning duplicate servers.
 */
export async function getOmdbMcp(): Promise<OmdbMcpClient> {
  if (singleton) return singleton;
  if (!connecting) {
    const client = new OmdbMcpClient();
    connecting = client
      .connect()
      .then(() => {
        singleton = client;
        return client;
      })
      .catch((error) => {
        connecting = null;
        throw error;
      });
  }
  return connecting;
}
