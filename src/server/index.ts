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

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
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

const DATA_DIR = path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'chat-history.json');
const SUMMARIES_FILE = path.join(DATA_DIR, 'summaries.json');

interface SessionSummary {
  sessionId: string;
  title: string;
  createdAt: string;
  summary: string;
}

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

function loadSummaries(): SessionSummary[] {
  try {
    if (!fs.existsSync(SUMMARIES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSummaries(summaries: SessionSummary[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(summaries, null, 2), 'utf-8');
}

app.get('/api/history', (req, res) => {
  const excludeId = req.query.exclude as string | undefined;
  const summaries = loadSummaries().filter(s => s.sessionId !== excludeId);

  if (summaries.length === 0) {
    res.json({ system: '' });
    return;
  }

  const parts = summaries.map(s => {
    const date = new Date(s.createdAt).toLocaleDateString();
    return `[${date} — ${s.title}]\n${s.summary}`;
  });
  res.json({ system: 'Summaries of previous conversations:\n\n' + parts.join('\n\n') });
});

app.get('/api/sessions', (_req, res) => {
  const sessions = loadSessions();
  const list = sessions
    .map(({ id, title, createdAt, updatedAt, messages }) => ({
      id, title, createdAt, updatedAt, messageCount: messages.length,
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
  const { messages } = req.body as { messages: ChatMessage[] };
  const sessions = loadSessions();
  const now = new Date().toISOString();
  const firstUser = messages.find(m => m.role === 'user');
  const title = firstUser ? firstUser.content.slice(0, 60) : 'New chat';
  const session: Session = { id: randomUUID(), title, createdAt: now, updatedAt: now, messages };
  sessions.push(session);
  saveSessions(sessions);
  res.json({ id: session.id });
});

app.patch('/api/sessions/:id', (req, res) => {
  const { messages } = req.body as { messages: ChatMessage[] };
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
  sessions[idx].messages = messages;
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

  // Remove associated summary too
  const summaries = loadSummaries().filter(s => s.sessionId !== req.params.id);
  saveSummaries(summaries);

  res.json({ ok: true });
});

app.post('/api/sessions/:id/summarize', async (req, res) => {
  const sessions = loadSessions();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) { res.status(404).json({ error: 'Not found' }); return; }
  if (session.messages.length === 0) { res.json({ summary: '' }); return; }

  try {
    const transcript = session.messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Summarize this conversation in 2–4 concise sentences. Focus on key topics discussed, decisions made, and outcomes. Start directly with the summary.\n\n${transcript}`,
      }],
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text : '';

    const summaries = loadSummaries();
    const existingIdx = summaries.findIndex(s => s.sessionId === session.id);
    const entry: SessionSummary = { sessionId: session.id, title: session.title, createdAt: session.createdAt, summary };
    if (existingIdx >= 0) summaries[existingIdx] = entry;
    else summaries.push(entry);
    saveSummaries(summaries);

    console.log(`[summarize] session ${session.id} done`);
    res.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[summarize] error:', message);
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
  res.on('close', () => { aborted = true; });

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

    const stream = client.messages.stream({
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[chat] error:', message);
    if (!aborted) {
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
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
