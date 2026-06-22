import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';

// Configure the server BEFORE importing it: isolate persistence to a temp dir,
// provide a dummy API key (chat is not exercised), and ensure it doesn't listen.
process.env.VITEST = 'true';
process.env.ANTHROPIC_API_KEY ||= 'test-key-not-used';
const dataDir = mkdtempSync(join(tmpdir(), 'claude-chat-api-'));
process.env.DATA_DIR = dataDir;

const { app } = await import('../../src/server/index');

beforeEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe('invariants API', () => {
  it('supports the full CRUD + validation lifecycle', async () => {
    await request(app).get('/api/invariants').expect(200, { entries: [] });

    const add = await request(app).post('/api/invariants').send({ entry: 'no secrets in logs' }).expect(200);
    expect(add.body.entries).toEqual(['no secrets in logs']);

    await request(app).post('/api/invariants').send({ entry: '   ' }).expect(400);

    const del = await request(app).delete('/api/invariants/0').expect(200);
    expect(del.body.entries).toEqual([]);

    await request(app).delete('/api/invariants/5').expect(404);
  });
});

describe('long-term memory API', () => {
  it('adds, lists, validates and deletes entries', async () => {
    await request(app).post('/api/long-term-memory').send({ entry: 'likes dark mode' }).expect(200);
    const list = await request(app).get('/api/long-term-memory').expect(200);
    expect(list.body.entries).toEqual(['likes dark mode']);

    await request(app).post('/api/long-term-memory').send({ entry: '' }).expect(400);
    await request(app).delete('/api/long-term-memory/0').expect(200);
    await request(app).get('/api/long-term-memory').expect(200, { entries: [] });
  });
});

describe('profiles API', () => {
  it('creates+activates, validates, switches and deletes', async () => {
    const created = await request(app).post('/api/profiles').send({ name: 'Terse', definition: 'be brief' }).expect(200);
    const id = created.body.profiles[0].id;
    expect(created.body.activeProfileId).toBe(id);

    await request(app).post('/api/profiles').send({ name: '', definition: '' }).expect(400);
    await request(app).patch('/api/profiles/active').send({ id: 'does-not-exist' }).expect(404);

    const deleted = await request(app).delete(`/api/profiles/${id}`).expect(200);
    expect(deleted.body.profiles).toEqual([]);
    expect(deleted.body.activeProfileId).toBeNull();
  });
});

describe('sessions API', () => {
  it('creates, lists, fetches and deletes a session', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .send({ messages: [{ role: 'user', content: 'hello world' }] })
      .expect(200);
    const id = created.body.id;
    expect(id).toBeTruthy();

    const list = await request(app).get('/api/sessions').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].title).toBe('hello world');
    expect(list.body[0].messageCount).toBe(1);

    await request(app).get(`/api/sessions/${id}`).expect(200);
    await request(app).get('/api/sessions/does-not-exist').expect(404);

    await request(app).delete(`/api/sessions/${id}`).expect(200);
    await request(app).get('/api/sessions').expect(200, []);
  });
});

describe('chat API validation', () => {
  it('rejects requests with no messages (without calling the model)', async () => {
    await request(app).post('/api/chat').send({ messages: [] }).expect(400);
    await request(app).post('/api/chat').send({}).expect(400);
  });
});
