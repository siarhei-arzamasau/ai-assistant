import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'dist/public')));

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface BranchData {
  id: string;
  label: string;
  createdAt: string;
  messages: ChatMessage[];
}

interface Profile {
  id: string;
  name: string;
  definition: string;
  createdAt: string;
}

interface ProfilesData {
  profiles: Profile[];
  activeProfileId: string | null;
}

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  strategy?: string;
  slidingWindowSize?: number;
  facts?: Record<string, string>;
  branches?: BranchData[];
  activeBranchId?: string;
  workingMemory?: string[];
}

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
]);

interface ChatSettings {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'chat-history.json');
const LONG_TERM_MEMORY_FILE = path.join(DATA_DIR, 'long-term-memory.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const INVARIANTS_FILE = path.join(DATA_DIR, 'invariants.json');

function loadSessions(): Session[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

function loadLongTermMemory(): string[] {
  try {
    if (!fs.existsSync(LONG_TERM_MEMORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(LONG_TERM_MEMORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveLongTermMemory(entries: string[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LONG_TERM_MEMORY_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

function loadProfiles(): ProfilesData {
  try {
    if (!fs.existsSync(PROFILES_FILE)) return { profiles: [], activeProfileId: null };
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
  } catch {
    return { profiles: [], activeProfileId: null };
  }
}

function saveProfiles(data: ProfilesData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadInvariants(): string[] {
  try {
    if (!fs.existsSync(INVARIANTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(INVARIANTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveInvariants(entries: string[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INVARIANTS_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

app.get('/api/history', (req, res) => {
  const sessions = loadSessions();
  const excludeId = req.query.exclude as string | undefined;
  const messages = sessions
    .filter(s => s.id !== excludeId)
    .flatMap(s => s.messages);
  res.json(messages);
});

app.get('/api/sessions', (_req, res) => {
  const sessions = loadSessions();
  const list = sessions
    .map(({ id, title, createdAt, updatedAt, messages, strategy, slidingWindowSize }) => ({
      id, title, createdAt, updatedAt, messageCount: messages.length, strategy, slidingWindowSize,
    }))
    .reverse();
  res.json(list);
});

app.get('/api/sessions/:id', (req, res) => {
  const sessions = loadSessions();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(session);
});

app.post('/api/sessions', (req, res) => {
  const { messages, strategy, slidingWindowSize, facts, branches, activeBranchId, workingMemory } = req.body as { messages: ChatMessage[]; strategy?: string; slidingWindowSize?: number; facts?: Record<string, string>; branches?: BranchData[]; activeBranchId?: string; workingMemory?: string[] };
  const sessions = loadSessions();
  const now = new Date().toISOString();
  const firstUser = messages.find(m => m.role === 'user');
  const title = firstUser ? firstUser.content.slice(0, 60) : 'New chat';
  const session: Session = { id: randomUUID(), title, createdAt: now, updatedAt: now, messages, strategy, slidingWindowSize, facts, branches, activeBranchId, workingMemory };
  sessions.push(session);
  saveSessions(sessions);
  res.json({ id: session.id });
});

app.patch('/api/sessions/:id', (req, res) => {
  const { messages, strategy, slidingWindowSize, facts, branches, activeBranchId, workingMemory } = req.body as { messages: ChatMessage[]; strategy?: string; slidingWindowSize?: number; facts?: Record<string, string>; branches?: BranchData[]; activeBranchId?: string; workingMemory?: string[] };
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
  sessions[idx].messages = messages;
  sessions[idx].strategy = strategy;
  sessions[idx].slidingWindowSize = slidingWindowSize;
  sessions[idx].facts = facts;
  sessions[idx].branches = branches;
  sessions[idx].activeBranchId = activeBranchId;
  sessions[idx].workingMemory = workingMemory;
  sessions[idx].updatedAt = new Date().toISOString();
  saveSessions(sessions);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', (req, res) => {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
  sessions.splice(idx, 1);
  saveSessions(sessions);
  res.json({ ok: true });
});

app.get('/api/long-term-memory', (_req, res) => {
  res.json({ entries: loadLongTermMemory() });
});

app.post('/api/long-term-memory', (req, res) => {
  const { entry } = req.body as { entry: string };
  if (!entry || !entry.trim()) { res.status(400).json({ error: 'entry is required' }); return; }
  const entries = loadLongTermMemory();
  entries.push(entry.trim());
  saveLongTermMemory(entries);
  res.json({ entries });
});

app.delete('/api/long-term-memory/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  const entries = loadLongTermMemory();
  if (isNaN(index) || index < 0 || index >= entries.length) { res.status(404).json({ error: 'Not found' }); return; }
  entries.splice(index, 1);
  saveLongTermMemory(entries);
  res.json({ entries });
});

app.get('/api/invariants', (_req, res) => {
  res.json({ entries: loadInvariants() });
});

app.post('/api/invariants', (req, res) => {
  const { entry } = req.body as { entry: string };
  if (!entry || !entry.trim()) { res.status(400).json({ error: 'entry is required' }); return; }
  const entries = loadInvariants();
  entries.push(entry.trim());
  saveInvariants(entries);
  res.json({ entries });
});

app.delete('/api/invariants/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  const entries = loadInvariants();
  if (isNaN(index) || index < 0 || index >= entries.length) { res.status(404).json({ error: 'Not found' }); return; }
  entries.splice(index, 1);
  saveInvariants(entries);
  res.json({ entries });
});

app.get('/api/profiles', (_req, res) => {
  res.json(loadProfiles());
});

app.post('/api/profiles', (req, res) => {
  const { name, definition } = req.body as { name: string; definition: string };
  if (!name || !name.trim() || !definition || !definition.trim()) {
    res.status(400).json({ error: 'name and definition are required' });
    return;
  }
  const data = loadProfiles();
  const profile: Profile = { id: randomUUID(), name: name.trim(), definition: definition.trim(), createdAt: new Date().toISOString() };
  data.profiles.push(profile);
  data.activeProfileId = profile.id;
  saveProfiles(data);
  res.json(data);
});

app.patch('/api/profiles/active', (req, res) => {
  const { id } = req.body as { id: string | null };
  const data = loadProfiles();
  if (id !== null && !data.profiles.some(p => p.id === id)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  data.activeProfileId = id;
  saveProfiles(data);
  res.json(data);
});

app.delete('/api/profiles/:id', (req, res) => {
  const data = loadProfiles();
  const idx = data.profiles.findIndex(p => p.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
  data.profiles.splice(idx, 1);
  if (data.activeProfileId === req.params.id) data.activeProfileId = null;
  saveProfiles(data);
  res.json(data);
});

app.post('/api/sessions/:id/extract-facts', async (req, res) => {
  const { userMessage, assistantMessage } = req.body as { userMessage: string; assistantMessage: string };
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }

  const currentFacts = sessions[idx].facts ?? {};

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You maintain a key-value store of important facts from a conversation. Extract details like names, goals, preferences, constraints, insights, decisions, solutions, ideas, and expectations.

Current facts:
${JSON.stringify(currentFacts)}

Latest exchange:
USER: ${userMessage}
ASSISTANT: ${assistantMessage}

Update the facts: add new ones, update changed values, keep the rest. Keys must be concise snake_case. Values must be one line.
Respond with ONLY a JSON object — no markdown, no explanation.`,
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
    let facts: Record<string, string> = {};
    try {
      const match = raw.replace(/```(?:json)?\n?|```/g, '').match(/\{[\s\S]*\}/);
      if (match) facts = JSON.parse(match[0]);
    } catch { facts = currentFacts; }

    sessions[idx].facts = facts;
    saveSessions(sessions);
    console.log(`[facts] session ${req.params.id} updated (${Object.keys(facts).length} facts)`);
    res.json({ facts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[facts] error:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages, settings = {}, system = '' } = req.body as { messages: ChatMessage[]; settings?: ChatSettings; system?: string };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Invalid messages format' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let aborted = false;
  let stream: ReturnType<typeof client.messages.stream> | undefined;
  // When the client interrupts, it closes the fetch connection. Abort the
  // upstream Anthropic stream too so we stop generating (and billing) tokens
  // immediately instead of waiting for the next event to break the loop.
  res.on('close', () => {
    aborted = true;
    if (stream && typeof stream.abort === 'function') stream.abort();
  });

  // Keep the SSE connection alive while the model is thinking
  const heartbeat = setInterval(() => {
    if (!aborted) res.write(': keep-alive\n\n');
  }, 15000);

  try {
    const model = ALLOWED_MODELS.has(settings.model ?? '') ? settings.model! : 'claude-sonnet-4-6';
    const isOpus  = model === 'claude-opus-4-8';
    const isHaiku = model === 'claude-haiku-4-5-20251001';

    console.log(`[chat] request — ${messages.length} message(s), model=${model}`);

    const maxTokens = Math.min(Math.max(Math.round(settings.maxTokens ?? 16000), 1), 16000);
    // Opus: temperature deprecated — always use default (1). Others: honour the setting.
    const temperature = isOpus ? 1 : Math.min(Math.max(settings.temperature ?? 1, 0), 1);
    const stopSequences = (settings.stopSequences ?? []).filter(s => s.length > 0);
    // Haiku doesn't support thinking. Others support it only at temperature === 1.
    const useThinking = !isHaiku && temperature === 1;

    stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      ...(system && { system }),
      ...(useThinking && { thinking: { type: 'adaptive' } }),
      ...(!isOpus && temperature !== 1 && { temperature }),
      ...(stopSequences.length > 0 && { stop_sequences: stopSequences }),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    let thinking = false;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (aborted) break;

      if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens;
      }

      if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens;
      }

      if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
        thinking = true;
        res.write(`data: ${JSON.stringify({ thinking: true })}\n\n`);
      }

      if (event.type === 'content_block_start' && event.content_block.type === 'text' && thinking) {
        thinking = false;
        res.write(`data: ${JSON.stringify({ thinking: false })}\n\n`);
      }

      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ usage: { input: inputTokens, output: outputTokens } })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    console.log('[chat] stream complete');
  } catch (error) {
    if (aborted) {
      // Expected: the user interrupted, so the upstream stream was aborted.
      console.log('[chat] stream aborted by client');
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[chat] error:', message);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist/public/index.html'));
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);
// Don't bind a port when imported by the test runner — tests drive `app` directly.
if (!process.env.VITEST) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

export { app };
