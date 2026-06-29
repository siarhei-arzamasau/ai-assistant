import type { TaskStage } from './types';

export const TASK_STAGES: TaskStage[] = ['planning', 'execution', 'validation', 'done'];

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  planning: 'Planning',
  execution: 'Execution',
  validation: 'Validation',
  done: 'Done',
};

// Single source of truth for the slash commands — drives both the /help output
// and the command-matching regex in the send dispatcher.
export const COMMANDS: { usage: string; description: string }[] = [
  { usage: '/help', description: 'Show this list of commands' },
  { usage: '/short-memory <text>', description: 'Add to short-term memory (this dialog only, never saved)' },
  { usage: '/work-memory <text>', description: 'Add to working memory (this session/task, saved)' },
  { usage: '/long-memory <text>', description: 'Add to long-term memory (global, all dialogs)' },
  { usage: '/create-profile <name> <definition>', description: 'Create and activate a response profile (style/format/limits)' },
  { usage: '/profile', description: 'Show the active profile' },
  { usage: '/switch-profile <name>', description: 'Switch the active profile' },
  { usage: '/add-invariant <text>', description: 'Add a global hard constraint the assistant must never break' },
  { usage: '/invariants', description: 'List all invariants' },
  { usage: '/task <description>', description: 'Run a staged task: planning → execution → validation → done (reply “стоп” to stop)' },
];

export const COMMAND_REGEX =
  /^\/(help|short-memory|work-memory|long-memory|create-profile|profile|switch-profile|task|add-invariant|invariants)(?:\s+([\s\S]+))?$/;

export const MODELS: { value: string; label: string }[] = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
];

// MCP servers the agent can connect to. The `id` is sent to the backend in the
// /api/chat request; the registry on the server resolves it to a real server.
export const MCP_SERVERS: { id: string; label: string }[] = [
  { id: 'omdb', label: 'OMDb' },
  { id: 'weather', label: 'Weather' },
];

export const STRATEGIES: { value: string; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'sliding-window', label: 'Sliding Window' },
  { value: 'sticky-facts', label: 'Sticky Facts' },
  { value: 'branching', label: 'Branching' },
];
