import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { tailorWithOpenRouter } from '../server/ai';
import type { Analysis, JobInput } from '../shared/types';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const job: JobInput = { company: 'Example', role: 'Software Engineer', description: 'Build AWS services and TypeScript APIs.', url: '', instructions: '' };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nomoreats-provider-')); dirs.push(dir);
  const store = await Store.open(dir); await store.saveSettings({ model: 'test/structured-model', apiKey: 'sk-local-fixture-only' });
  const slot = store.state().template.slots[0];
  const analysis: Analysis = { summary: 'Emphasize API development.', edits: [{ slotId: slot.id, text: slot.original.replace('Built', 'Developed'), reason: 'Clear action.', evidenceIds: ['experience.govtech.bullet.0'] }], requirements: [], gaps: [], warnings: [], reuseSuggestion: null };
  return { store, analysis };
}
describe('OpenRouter orchestration', () => {
  it('sends a private structured request and persists the validated resume/job snapshots', async () => {
    const { store, analysis } = await fixture();
    let outbound: any;
    const fetcher: typeof fetch = async (_url, init) => { outbound = JSON.parse(String(init!.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) }, finish_reason: 'stop' }] }), { status: 200 }); };
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher }), compile: async () => ({ status: 'ready', pages: 1, message: 'Fixture compiler', warnings: [] }) });
    const response = await request(app).post('/api/tailor').send({ job, forceNew: true });
    expect(response.status).toBe(201);
    expect(response.body.resume.latex).toContain('Developed an API observability dashboard');
    expect(response.body.resume.profileSnapshot.contact.name).toBe('Nicholas Seah');
    expect(response.body.job.resumeId).toBe(response.body.resume.id);
    expect(store.state().resumes).toHaveLength(2);
    expect(outbound.response_format.type).toBe('json_schema'); expect(outbound.provider).toEqual({ require_parameters: true, data_collection: 'deny', zdr: true });
    expect(outbound.reasoning).toBeUndefined();
    expect(outbound.messages[1].content).not.toContain('nicholasseah02@gmail.com');
    expect(outbound.messages[1].content).not.toContain('sk-local-fixture-only');
  });
  it('reduces DeepSeek reasoning while leaving room for the final structured answer', async () => {
    const { store, analysis } = await fixture();
    await store.saveSettings({ model: 'deepseek/deepseek-v4.1-flash' });
    let outbound: any;
    const fetcher: typeof fetch = async (_url, init) => {
      outbound = JSON.parse(String(init!.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(analysis) }, finish_reason: 'stop' }] });
    };
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher }), compile: async () => ({ status: 'ready', pages: 1, message: 'Fixture compiler', warnings: [] }) });
    const response = await request(app).post('/api/tailor').send({ job, forceNew: true });
    expect(response.status).toBe(201);
    expect(response.body.resume.latex).toContain('Developed an API observability dashboard');
    expect(outbound.reasoning).toEqual({ effort: 'low' });
    expect(outbound.max_tokens).toBeGreaterThan(9000);
    expect(outbound.response_format.type).toBe('json_schema');
    expect(outbound.provider).toEqual({ require_parameters: true, data_collection: 'deny', zdr: true });
  });
  it('returns an advisory reuse choice without saving duplicate resumes or draft jobs', async () => {
    const { store, analysis } = await fixture();
    analysis.reuseSuggestion = { resumeId: store.state().resumes[0].id, reason: 'The original covers this role.' };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }));
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher }), compile: async () => ({ status: 'ready', pages: 1, message: 'Fixture compiler', warnings: [] }) });
    const response = await request(app).post('/api/tailor').send({ job });
    expect(response.status).toBe(200); expect(response.body.resume).toBeNull(); expect(response.body.suggestedResume.id).toBe(analysis.reuseSuggestion.resumeId);
    expect(store.state().resumes).toHaveLength(1); expect(store.state().jobs).toHaveLength(0);
  });
  it('keeps saved data intact on credit errors or malformed model output', async () => {
    const { store } = await fixture();
    for (const fakeResponse of [new Response('{}', { status: 402 }), new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }))]) {
      const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher: async () => fakeResponse }) });
      const response = await request(app).post('/api/tailor').send({ job });
      expect(response.status).toBe(400); expect(response.body.error).toBeTruthy();
      expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
    }
  });
  it.each(['response', 'choice'] as const)('reports provider errors in an HTTP 200 %s without saving partial results', async location => {
    const { store, analysis } = await fixture();
    const error = { code: 502, message: 'Upstream failure with sk-local-fixture-only and private prompt text', metadata: { error_type: 'provider_unavailable' } };
    const payload = location === 'response'
      ? { id: 'gen-provider-failed', error }
      : { id: 'gen-provider-failed', choices: [{ message: { content: JSON.stringify(analysis) }, finish_reason: 'error', error }] };
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher: async () => Response.json(payload) }), compile: async () => ({ status: 'ready', pages: 1, message: 'Fixture compiler', warnings: [] }) });
    const response = await request(app).post('/api/tailor').send({ job });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/provider.*unavailable/i);
    expect(response.body.error).toContain('gen-provider-failed');
    expect(response.body.error).not.toContain('sk-local-fixture-only');
    expect(response.body.error).not.toContain('private prompt text');
    expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
  });
  it('reports the embedded error code when OpenRouter omits typed error metadata', async () => {
    const { store } = await fixture();
    const payload = { id: 'gen-rate-limited', error: { code: 429, message: 'Private upstream details' } };
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher: async () => Response.json(payload) }) });
    const response = await request(app).post('/api/tailor').send({ job });
    expect(response.status).toBe(400); expect(response.body.error).toMatch(/rate limit/i);
    expect(response.body.error).toContain('gen-rate-limited');
    expect(response.body.error).not.toContain('Private upstream details');
    expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
  });
  it.each(['reasoning only', 'valid-looking partial JSON'] as const)('reports the token limit for %s rather than accepting an incomplete generation', async mode => {
    const { store, analysis } = await fixture();
    const payload = { id: 'gen-token-limit', choices: [{ message: { content: mode === 'reasoning only' ? null : JSON.stringify(analysis), reasoning: 'Private reasoning text' }, finish_reason: 'length' }], usage: { completion_tokens: 9000, completion_tokens_details: { reasoning_tokens: 9000 } } };
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher: async () => Response.json(payload) }), compile: async () => ({ status: 'ready', pages: 1, message: 'Fixture compiler', warnings: [] }) });
    const response = await request(app).post('/api/tailor').send({ job });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/token limit/i);
    expect(response.body.error).toContain('gen-token-limit');
    expect(response.body.error).not.toContain('Private reasoning text');
    expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
  });
  it('reports a model refusal without exposing its text', async () => {
    const { store } = await fixture();
    const payload = { id: 'gen-refused', choices: [{ message: { content: null, refusal: 'Private refusal text' }, finish_reason: 'content_filter' }] };
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher: async () => Response.json(payload) }) });
    const response = await request(app).post('/api/tailor').send({ job });
    expect(response.status).toBe(400); expect(response.body.error).toMatch(/refused|filtered/i);
    expect(response.body.error).not.toContain('Private refusal text');
    expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
  });
  it.each([null, '', '   '])('reports a missing final answer for content %j with a request ID', async content => {
    const { store } = await fixture();
    const payload = { id: 'gen-empty', choices: [{ message: { content }, finish_reason: 'stop' }] };
    const app = createApp(store, { generate: options => tailorWithOpenRouter({ ...options, fetcher: async () => Response.json(payload) }) });
    const response = await request(app).post('/api/tailor').send({ job });
    expect(response.status).toBe(400); expect(response.body.error).toMatch(/no final answer/i);
    expect(response.body.error).toContain('gen-empty');
    expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
  });
});
