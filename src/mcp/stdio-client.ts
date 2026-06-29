import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface StdioMcpClientOptions {
  /** Client name reported to the server during initialization. */
  name: string;
  /** Path to the TypeScript server entry, relative to the project root. */
  entry: string;
  /** Client version reported to the server during initialization. */
  version?: string;
}

/** Absolute path to the local `tsx` binary used to run the TypeScript server. */
const TSX_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

/**
 * A thin wrapper around the official MCP SDK `Client` that spawns a local
 * TypeScript MCP server as a child process and talks to it over stdio. The
 * server inherits the current environment (so API keys and `DATA_DIR` reach it).
 */
export class StdioMcpClient {
  private readonly client: Client;
  private readonly transport: StdioClientTransport;
  private connected = false;

  constructor(options: StdioMcpClientOptions) {
    this.transport = new StdioClientTransport({
      command: TSX_BIN,
      args: [options.entry],
      env: process.env as Record<string, string>,
    });

    this.client = new Client(
      { name: options.name, version: options.version ?? '1.0.0' },
      { capabilities: {} },
    );
  }

  /** Open the connection (spawning the server) and run the MCP handshake. */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }

  /** List every tool the server exposes. */
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
      throw new Error('StdioMcpClient is not connected. Call connect() first.');
    }
  }
}
