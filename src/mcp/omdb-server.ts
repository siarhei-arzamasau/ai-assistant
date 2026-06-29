import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

/** OMDb API base endpoint. */
const OMDB_URL = 'https://www.omdbapi.com/';

/**
 * Call the OMDb API with the given query parameters (the `apikey` is added
 * automatically). Returns the parsed JSON, or a normalized `{ error }` object
 * when OMDb reports a failure (`Response: "False"`).
 */
async function omdbFetch(
  params: Record<string, string | number | undefined>,
): Promise<Record<string, unknown>> {
  const apikey = process.env.OMDB_API_KEY;
  if (!apikey) {
    throw new Error(
      'Missing OMDb API key. Set OMDB_API_KEY in the environment (get a free key at https://www.omdbapi.com/apikey.aspx).',
    );
  }

  const url = new URL(OMDB_URL);
  url.searchParams.set('apikey', apikey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OMDb request failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (data.Response === 'False') {
    return { error: data.Error ?? 'Unknown OMDb error' };
  }
  return data;
}

/** The tools this server exposes, in MCP `Tool` shape (JSON Schema input). */
const TOOLS: Tool[] = [
  {
    name: 'search_movies',
    description:
      'Search the OMDb database for movies, series or episodes by title keywords. ' +
      'Returns a paginated list of matches with titles, years, IMDb IDs and poster URLs. ' +
      'Use this when the user does not know the exact title or wants several options.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Title keywords to search for (OMDb "s" parameter), e.g. "hackers".',
        },
        type: {
          type: 'string',
          enum: ['movie', 'series', 'episode'],
          description: 'Restrict results to a specific type.',
        },
        year: {
          type: 'string',
          description: 'Restrict results to a release year, e.g. "1999".',
        },
        page: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Result page (10 results per page). Defaults to 1.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_movie',
    description:
      'Get full details for a single movie/series by exact title or by IMDb ID. ' +
      'Returns plot, cast, director, ratings, runtime, genre and more. ' +
      'Provide either `title` or `imdbId` (IMDb ID is more precise).',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Exact title (OMDb "t" parameter). Use when you do not have an IMDb ID.',
        },
        imdbId: {
          type: 'string',
          description: 'IMDb ID such as "tt0133093" (OMDb "i" parameter). Most precise.',
        },
        year: {
          type: 'string',
          description: 'Release year to disambiguate titles, e.g. "1999".',
        },
        plot: {
          type: 'string',
          enum: ['short', 'full'],
          description: 'Plot length. Defaults to "short".',
        },
      },
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: 'omdb-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args = {} } = request.params;

  try {
    let data: Record<string, unknown>;

    switch (name) {
      case 'search_movies': {
        const { query, type, year, page } = args as {
          query?: string;
          type?: string;
          year?: string;
          page?: number;
        };
        if (!query) throw new Error('`query` is required for search_movies.');
        data = await omdbFetch({ s: query, type, y: year, page });
        break;
      }

      case 'get_movie': {
        const { title, imdbId, year, plot } = args as {
          title?: string;
          imdbId?: string;
          year?: string;
          plot?: string;
        };
        if (!title && !imdbId) {
          throw new Error('Provide either `title` or `imdbId` for get_movie.');
        }
        data = await omdbFetch({ t: title, i: imdbId, y: year, plot });
        break;
      }

      default:
        throw new Error(`Unknown tool "${name}".`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: Boolean(data.error),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error calling ${name}: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they never corrupt the stdio JSON-RPC stream.
  console.error('OMDb MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in OMDb MCP server:', error);
  process.exit(1);
});
