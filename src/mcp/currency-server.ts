import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { aggregateRates, type RateObservation } from './currency-aggregate.js';

/** currencylayer live-rates endpoint (free plan is HTTP only, source = USD). */
const CURRENCYLAYER_URL = 'http://api.currencylayer.com/live';
const DEFAULT_SOURCE = 'USD';

// ---- persistence -----------------------------------------------------------
// Stored under the same data dir as the rest of the app so everything lives in
// one place (data/ is gitignored). DATA_DIR is inherited from the backend.
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const CURRENCY_DIR = path.join(DATA_DIR, 'currency');
const JOBS_FILE = path.join(CURRENCY_DIR, 'jobs.json');
const OBS_FILE = path.join(CURRENCY_DIR, 'observations.json');

type JobType = 'collection' | 'reminder';
type JobStatus = 'active' | 'done' | 'cancelled';

interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  nextRunAt: string; // ISO; for reminders this is the due time
  runCount: number;
  // collection
  currencies?: string; // comma-separated quote currencies, e.g. "EUR,GBP"
  source?: string; // base currency, e.g. "USD"
  intervalSeconds?: number; // canonical repeat interval
  intervalMinutes?: number; // legacy field, still read for back-compat on resume
  maxRuns?: number;
  // reminder
  message?: string;
  firedAt?: string;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function ensureDir(): void {
  fs.mkdirSync(CURRENCY_DIR, { recursive: true });
}

// In-memory state is the source of truth while running; every mutation is
// persisted so an active schedule survives a backend restart.
let jobs: Job[] = [];
let observations: RateObservation[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function saveJobs(): void {
  ensureDir();
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
}

function saveObservations(): void {
  ensureDir();
  fs.writeFileSync(OBS_FILE, JSON.stringify(observations, null, 2), 'utf-8');
}

// ---- currencylayer ---------------------------------------------------------
/** Normalize a currencies arg (string or array) into an uppercase CSV list. */
function normalizeCurrencies(input: unknown): string {
  const raw = Array.isArray(input) ? input.join(',') : String(input ?? '');
  return raw
    .split(/[\s,]+/)
    .map(c => c.trim().toUpperCase())
    .filter(Boolean)
    .join(',');
}

interface LiveRates {
  source: string;
  observedAt: string;
  quotes: Record<string, number>; // e.g. { "USDEUR": 0.92 }
}

/** Fetch live exchange rates. Returns the quotes or `{ error }`. */
async function fetchRates(
  currencies: string,
  source: string,
): Promise<LiveRates | { error: string }> {
  const accessKey = process.env.CURRENCY_API_KEY;
  if (!accessKey) {
    return {
      error:
        'Missing currencylayer API key. Set CURRENCY_API_KEY in the environment (free key at https://currencylayer.com/).',
    };
  }

  const url = new URL(CURRENCYLAYER_URL);
  url.searchParams.set('access_key', accessKey);
  url.searchParams.set('source', source);
  if (currencies) url.searchParams.set('currencies', currencies);
  url.searchParams.set('format', '1');

  const response = await fetch(url);
  if (!response.ok) return { error: `currencylayer request failed with HTTP ${response.status}` };

  const data = (await response.json()) as {
    success?: boolean;
    error?: { info?: string };
    source?: string;
    quotes?: Record<string, number>;
  };

  if (data.success === false || !data.quotes) {
    return { error: data.error?.info ?? 'currencylayer returned no data' };
  }

  return {
    source: data.source ?? source,
    observedAt: new Date().toISOString(),
    quotes: data.quotes,
  };
}

/** Turn a live-rates payload into per-pair observation rows for a job. */
function toObservations(jobId: string, live: LiveRates): RateObservation[] {
  return Object.entries(live.quotes).map(([pair, rate]) => ({
    jobId,
    observedAt: live.observedAt,
    source: live.source,
    currency: pair.startsWith(live.source) ? pair.slice(live.source.length) : pair,
    pair,
    rate,
  }));
}

// ---- scheduler -------------------------------------------------------------
function findJob(id: string): Job | undefined {
  return jobs.find(j => j.id === id);
}

/** A collection job's repeat interval in ms (prefers seconds, falls back to legacy minutes). */
function intervalMs(job: Job): number {
  if (job.intervalSeconds !== undefined) return job.intervalSeconds * 1000;
  return (job.intervalMinutes ?? 60) * 60_000;
}

/** Arm a timer for an active job based on its `nextRunAt` (overdue → fire now). */
function scheduleJob(job: Job): void {
  if (job.status !== 'active') return;
  const existing = timers.get(job.id);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, Date.parse(job.nextRunAt) - Date.now());
  timers.set(job.id, setTimeout(() => { void fireJob(job.id); }, delay));
}

/** Run a job's action when its timer fires, then persist and reschedule. */
async function fireJob(id: string): Promise<void> {
  timers.delete(id);
  const job = findJob(id);
  if (!job || job.status !== 'active') return;

  if (job.type === 'reminder') {
    job.status = 'done';
    job.firedAt = new Date().toISOString();
    job.runCount += 1;
    saveJobs();
    console.error(`[reminder] fired (${job.id}): ${job.message}`);
    return;
  }

  // collection
  const result = await fetchRates(job.currencies ?? '', job.source ?? DEFAULT_SOURCE);
  job.runCount += 1;
  if ('error' in result) {
    console.error(`[collection] ${job.id} fetch error: ${result.error}`);
  } else {
    const rows = toObservations(job.id, result);
    observations.push(...rows);
    saveObservations();
    console.error(`[collection] ${job.id} snapshot #${job.runCount}: ${rows.length} rate(s) from ${result.source}`);
  }

  if (job.maxRuns !== undefined && job.runCount >= job.maxRuns) {
    job.status = 'done';
    saveJobs();
    return;
  }

  job.nextRunAt = new Date(Date.now() + intervalMs(job)).toISOString();
  saveJobs();
  scheduleJob(job);
}

/** Load persisted state and resume every active job (overdue ones fire soon). */
function resumeFromDisk(): void {
  jobs = readJson<Job[]>(JOBS_FILE, []);
  observations = readJson<RateObservation[]>(OBS_FILE, []);
  for (const job of jobs) {
    if (job.status === 'active') scheduleJob(job);
  }
  const active = jobs.filter(j => j.status === 'active').length;
  console.error(`[currency] resumed ${active} active job(s) from disk`);
}

// ---- tools -----------------------------------------------------------------
const TOOLS: Tool[] = [
  {
    name: 'get_live_rates',
    description:
      'Get current exchange rates right now (one-off, not stored). Returns quotes like USDEUR. ' +
      'On the currencylayer free plan the source must be USD.',
    inputSchema: {
      type: 'object',
      properties: {
        currencies: { type: 'string', description: 'Comma-separated quote currencies, e.g. "EUR,GBP,JPY". Omit for all.' },
        source: { type: 'string', description: 'Base currency (default USD; free plan only supports USD).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'schedule_rate_collection',
    description:
      'Start a periodic job that records exchange rates into a JSON store on a schedule. ' +
      'Takes the first snapshot immediately, then repeats on the interval. Specify the interval with ' +
      'intervalSeconds and/or intervalMinutes (they add up); at least one is required. ' +
      'NOTE: the currencylayer free plan has a limited monthly quota — prefer larger intervals and a small maxRuns.',
    inputSchema: {
      type: 'object',
      properties: {
        currencies: { type: 'string', description: 'Comma-separated quote currencies to track, e.g. "EUR,GBP".' },
        source: { type: 'string', description: 'Base currency (default USD; free plan only supports USD).' },
        intervalSeconds: { type: 'number', minimum: 1, description: 'Seconds between snapshots. Combined with intervalMinutes.' },
        intervalMinutes: { type: 'number', minimum: 0, description: 'Minutes between snapshots. Combined with intervalSeconds.' },
        maxRuns: { type: 'integer', minimum: 1, description: 'Optional cap on the number of snapshots before the job stops.' },
      },
      required: ['currencies'],
      additionalProperties: false,
    },
  },
  {
    name: 'schedule_rate_reminder',
    description:
      'Schedule a one-off reminder to fire after a delay. Specify the delay with delaySeconds and/or ' +
      'delayMinutes (they add up); at least one is required. Retrieve fired reminders with list_due_rate_reminders.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The reminder text.' },
        delaySeconds: { type: 'number', minimum: 1, description: 'Seconds from now until the reminder fires. Combined with delayMinutes.' },
        delayMinutes: { type: 'number', minimum: 0, description: 'Minutes from now until the reminder fires. Combined with delaySeconds.' },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_rate_jobs',
    description: 'List all scheduled jobs (rate collections and reminders) with their status, run count and next run time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancel_rate_job',
    description: 'Cancel an active scheduled job by id.',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string', description: 'The job id returned when it was scheduled.' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_rate_summary',
    description:
      'Return an aggregated summary over collected rate observations: per currency pair the count, ' +
      'min/max/avg rate and the first→last change (absolute and %). Filter by jobId or by currency; ' +
      'omit both for all data.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Summarize only this collection job.' },
        currency: { type: 'string', description: 'Summarize only this quote currency, e.g. "EUR".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_due_rate_reminders',
    description: 'List reminders that have already fired, with their message and fired time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/**
 * Combine optional `*Seconds` and `*Minutes` args into a total number of
 * seconds. Returns `{ error }` if neither is given or a value is invalid.
 */
function totalSeconds(
  seconds: unknown,
  minutes: unknown,
  label: string,
): { seconds: number } | { error: string } {
  if (seconds === undefined && minutes === undefined) {
    return { error: `Provide ${label}Seconds and/or ${label}Minutes.` };
  }
  const s = seconds === undefined ? 0 : Number(seconds);
  const m = minutes === undefined ? 0 : Number(minutes);
  if (!Number.isFinite(s) || s < 0) return { error: `${label}Seconds must be a non-negative number.` };
  if (!Number.isFinite(m) || m < 0) return { error: `${label}Minutes must be a non-negative number.` };
  const total = Math.round(s + m * 60);
  if (total < 1) return { error: `${label} must total at least 1 second.` };
  return { seconds: total };
}

async function handleTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case 'get_live_rates': {
      const currencies = normalizeCurrencies(args.currencies);
      const source = String(args.source ?? DEFAULT_SOURCE).trim().toUpperCase() || DEFAULT_SOURCE;
      const result = await fetchRates(currencies, source);
      if ('error' in result) return fail(result.error);
      return ok(result);
    }

    case 'schedule_rate_collection': {
      const currencies = normalizeCurrencies(args.currencies);
      const source = String(args.source ?? DEFAULT_SOURCE).trim().toUpperCase() || DEFAULT_SOURCE;
      const maxRuns = args.maxRuns === undefined ? undefined : Number(args.maxRuns);
      if (!currencies) return fail('`currencies` is required (e.g. "EUR,GBP").');
      const interval = totalSeconds(args.intervalSeconds, args.intervalMinutes, 'interval');
      if ('error' in interval) return fail(interval.error);
      if (maxRuns !== undefined && (!Number.isInteger(maxRuns) || maxRuns < 1)) return fail('`maxRuns` must be an integer >= 1.');

      const now = new Date().toISOString();
      const job: Job = {
        id: `job_${randomUUID().slice(0, 8)}`,
        type: 'collection',
        status: 'active',
        createdAt: now,
        nextRunAt: now, // first snapshot immediately
        runCount: 0,
        currencies,
        source,
        intervalSeconds: interval.seconds,
        maxRuns,
      };
      jobs.push(job);
      saveJobs();
      scheduleJob(job);
      return ok({ jobId: job.id, status: job.status, currencies, source, intervalSeconds: interval.seconds, maxRuns, nextRunAt: job.nextRunAt });
    }

    case 'schedule_rate_reminder': {
      const message = String(args.message ?? '').trim();
      if (!message) return fail('`message` is required.');
      const delay = totalSeconds(args.delaySeconds, args.delayMinutes, 'delay');
      if ('error' in delay) return fail(delay.error);

      const now = new Date();
      const dueAt = new Date(now.getTime() + delay.seconds * 1000).toISOString();
      const job: Job = {
        id: `rem_${randomUUID().slice(0, 8)}`,
        type: 'reminder',
        status: 'active',
        createdAt: now.toISOString(),
        nextRunAt: dueAt,
        runCount: 0,
        message,
      };
      jobs.push(job);
      saveJobs();
      scheduleJob(job);
      return ok({ jobId: job.id, status: job.status, message, dueAt });
    }

    case 'list_rate_jobs':
      return ok({ jobs });

    case 'cancel_rate_job': {
      const jobId = String(args.jobId ?? '').trim();
      const job = findJob(jobId);
      if (!job) return fail(`No job with id "${jobId}".`);
      if (job.status !== 'active') return fail(`Job "${jobId}" is already ${job.status}.`);
      const timer = timers.get(jobId);
      if (timer) { clearTimeout(timer); timers.delete(jobId); }
      job.status = 'cancelled';
      saveJobs();
      return ok({ jobId, status: job.status });
    }

    case 'get_rate_summary': {
      const jobId = args.jobId === undefined ? undefined : String(args.jobId).trim();
      const currency = args.currency === undefined ? undefined : String(args.currency).trim().toUpperCase();
      let scoped = observations;
      if (jobId) scoped = scoped.filter(o => o.jobId === jobId);
      if (currency) scoped = scoped.filter(o => o.currency === currency);
      return ok({ filter: { jobId, currency }, summary: aggregateRates(scoped) });
    }

    case 'list_due_rate_reminders': {
      const fired = jobs
        .filter(j => j.type === 'reminder' && j.status === 'done')
        .map(j => ({ jobId: j.id, message: j.message, firedAt: j.firedAt }));
      return ok({ reminders: fired });
    }

    default:
      return fail(`Unknown tool "${name}".`);
  }
}

const server = new Server(
  { name: 'currency-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args = {} } = request.params;
  try {
    return await handleTool(name, args as Record<string, unknown>);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Unknown error');
  }
});

async function main(): Promise<void> {
  ensureDir();
  resumeFromDisk();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they never corrupt the stdio JSON-RPC stream.
  console.error('Currency MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in Currency MCP server:', error);
  process.exit(1);
});
