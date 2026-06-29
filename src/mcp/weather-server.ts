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
import { aggregateObservations, type Observation } from './weather-aggregate.js';

/** weatherstack current-weather endpoint (free plan is HTTP only). */
const WEATHERSTACK_URL = 'http://api.weatherstack.com/current';

// ---- persistence -----------------------------------------------------------
// Stored under the same data dir as the rest of the app so everything lives in
// one place (data/ is gitignored). DATA_DIR is inherited from the backend.
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const WEATHER_DIR = path.join(DATA_DIR, 'weather');
const JOBS_FILE = path.join(WEATHER_DIR, 'jobs.json');
const OBS_FILE = path.join(WEATHER_DIR, 'observations.json');

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
  location?: string;
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
  fs.mkdirSync(WEATHER_DIR, { recursive: true });
}

// In-memory state is the source of truth while running; every mutation is
// persisted so an active schedule survives a backend restart.
let jobs: Job[] = [];
let observations: Observation[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function saveJobs(): void {
  ensureDir();
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
}

function saveObservations(): void {
  ensureDir();
  fs.writeFileSync(OBS_FILE, JSON.stringify(observations, null, 2), 'utf-8');
}

// ---- weatherstack ----------------------------------------------------------
/** Fetch current weather for a location. Returns a snapshot or `{ error }`. */
async function fetchWeather(
  location: string,
): Promise<Omit<Observation, 'jobId'> | { error: string }> {
  const accessKey = process.env.WEATHERSTACK_API_KEY;
  if (!accessKey) {
    return {
      error:
        'Missing weatherstack API key. Set WEATHERSTACK_API_KEY in the environment (free key at https://weatherstack.com/).',
    };
  }

  const url = new URL(WEATHERSTACK_URL);
  url.searchParams.set('access_key', accessKey);
  url.searchParams.set('query', location);

  const response = await fetch(url);
  if (!response.ok) return { error: `weatherstack request failed with HTTP ${response.status}` };

  const data = (await response.json()) as {
    success?: boolean;
    error?: { info?: string };
    location?: { name?: string };
    current?: { temperature?: number; humidity?: number; wind_speed?: number; weather_descriptions?: string[] };
  };

  if (data.success === false || !data.current) {
    return { error: data.error?.info ?? 'weatherstack returned no data for this location' };
  }

  const c = data.current;
  return {
    location: data.location?.name ?? location,
    observedAt: new Date().toISOString(),
    temperature: c.temperature ?? NaN,
    humidity: c.humidity ?? NaN,
    windSpeed: c.wind_speed ?? NaN,
    description: Array.isArray(c.weather_descriptions) ? c.weather_descriptions.join(', ') : '',
  };
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
  const result = await fetchWeather(job.location ?? '');
  job.runCount += 1;
  if ('error' in result) {
    console.error(`[collection] ${job.id} fetch error: ${result.error}`);
  } else {
    observations.push({ jobId: job.id, ...result });
    saveObservations();
    console.error(`[collection] ${job.id} snapshot #${job.runCount} for ${result.location}: ${result.temperature}°C`);
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
  observations = readJson<Observation[]>(OBS_FILE, []);
  for (const job of jobs) {
    if (job.status === 'active') scheduleJob(job);
  }
  const active = jobs.filter(j => j.status === 'active').length;
  console.error(`[weather] resumed ${active} active job(s) from disk`);
}

// ---- tools -----------------------------------------------------------------
const TOOLS: Tool[] = [
  {
    name: 'get_current_weather',
    description: 'Get the current weather for a location right now (one-off, not stored).',
    inputSchema: {
      type: 'object',
      properties: { location: { type: 'string', description: 'City or place, e.g. "London".' } },
      required: ['location'],
      additionalProperties: false,
    },
  },
  {
    name: 'schedule_weather_collection',
    description:
      'Start a periodic job that records the weather for a location into a JSON store on a schedule. ' +
      'Takes the first snapshot immediately, then repeats on the interval. Specify the interval with ' +
      'intervalSeconds and/or intervalMinutes (they add up); at least one is required. ' +
      'NOTE: the weatherstack free plan allows only ~100 calls/month — prefer larger intervals and a small maxRuns.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or place to track, e.g. "London".' },
        intervalSeconds: { type: 'number', minimum: 1, description: 'Seconds between snapshots. Combined with intervalMinutes.' },
        intervalMinutes: { type: 'number', minimum: 0, description: 'Minutes between snapshots. Combined with intervalSeconds.' },
        maxRuns: { type: 'integer', minimum: 1, description: 'Optional cap on the number of snapshots before the job stops.' },
      },
      required: ['location'],
      additionalProperties: false,
    },
  },
  {
    name: 'schedule_reminder',
    description:
      'Schedule a one-off reminder to fire after a delay. Specify the delay with delaySeconds and/or ' +
      'delayMinutes (they add up); at least one is required. Retrieve fired reminders with list_due_reminders.',
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
    name: 'list_jobs',
    description: 'List all scheduled jobs (collections and reminders) with their status, run count and next run time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancel_job',
    description: 'Cancel an active scheduled job by id.',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string', description: 'The job id returned when it was scheduled.' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_weather_summary',
    description:
      'Return an aggregated summary (count, time range, min/max/avg temperature, avg humidity & wind, ' +
      'description frequencies) over collected observations. Filter by jobId or by location; omit both for all data.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Summarize only this collection job.' },
        location: { type: 'string', description: 'Summarize only observations for this location.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_due_reminders',
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
    case 'get_current_weather': {
      const location = String(args.location ?? '').trim();
      if (!location) return fail('`location` is required.');
      const result = await fetchWeather(location);
      if ('error' in result) return fail(result.error);
      return ok(result);
    }

    case 'schedule_weather_collection': {
      const location = String(args.location ?? '').trim();
      const maxRuns = args.maxRuns === undefined ? undefined : Number(args.maxRuns);
      if (!location) return fail('`location` is required.');
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
        location,
        intervalSeconds: interval.seconds,
        maxRuns,
      };
      jobs.push(job);
      saveJobs();
      scheduleJob(job);
      return ok({ jobId: job.id, status: job.status, location, intervalSeconds: interval.seconds, maxRuns, nextRunAt: job.nextRunAt });
    }

    case 'schedule_reminder': {
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

    case 'list_jobs':
      return ok({ jobs });

    case 'cancel_job': {
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

    case 'get_weather_summary': {
      const jobId = args.jobId === undefined ? undefined : String(args.jobId).trim();
      const location = args.location === undefined ? undefined : String(args.location).trim().toLowerCase();
      let scoped = observations;
      if (jobId) scoped = scoped.filter(o => o.jobId === jobId);
      if (location) scoped = scoped.filter(o => o.location.toLowerCase() === location);
      return ok({ filter: { jobId, location }, summary: aggregateObservations(scoped) });
    }

    case 'list_due_reminders': {
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
  { name: 'weather-mcp-server', version: '1.0.0' },
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
  console.error('Weather MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in Weather MCP server:', error);
  process.exit(1);
});
