import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';

const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'dist/public')));

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

app.post('/api/chat', async (req, res) => {
  const { messages, settings = {} } = req.body as { messages: ChatMessage[]; settings?: ChatSettings };

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
