import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import type { JobInput } from '../shared/types';
import { artifactPath } from '../server/pdf';
import { dirname } from 'node:path';
import { getEvidence } from '../shared/evidence';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResumeDetail } from '../src/components/ResumeDetail';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const job: JobInput = { company: 'Example Company', role: 'Software Engineer', description: 'Build TypeScript services and AWS APIs.', url: '', instructions: '' };
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'nomoreats-api-')); dirs.push(dir); const store = await Store.open(dir); return { store, app: createApp(store, { compile: async () => ({ status: 'ready', pages: 1, message: 'Fixture compiler', warnings: [] }) }) }; }
describe('workspace API', () => {
  it('keeps the current analysis evidence when linking an older resume', async () => {
    const { store, app } = await setup();
    const original = store.state().resumes[0];
    const profile = store.state().profile;
    profile.experience[0].notes = 'Built TypeScript services with contract tests.';
    await store.saveProfile(profile);
    const evidence = getEvidence(store.state().profile);
    const fact = evidence.find(item => item.text === profile.experience[0].notes)!;
    const analysis = { summary: 'TypeScript experience', edits: [], requirements: [{ term: 'TypeScript', sourceQuote: job.description, importance: 'required', covered: true, evidenceIds: [fact.id] }], gaps: [], warnings: [], reuseSuggestion: null };
    const response = await request(app).post('/api/jobs').send({ job, resumeId: original.id, analysis });
    expect(response.status).toBe(201);
    expect(response.body.evidenceSnapshot).toContainEqual(fact);
    expect(store.state().resumes[0].profileSnapshot.experience[0].notes).not.toBe(fact.text);
    const html = renderToStaticMarkup(createElement(ResumeDetail, {
      resume: { ...original, kind: 'tailored', analysis: response.body.analysis }, jobs: [response.body],
      onUpdate: () => {}, onStatus: async () => {}, onClose: () => {}, onUse: () => {},
    }));
    expect(html).toContain(fact.text);
    expect(html).toContain('Fully supported');
  });
  it('links multiple job descriptions to one immutable resume', async () => {
    const { store, app } = await setup();
    const original = store.state().resumes[0];
    const first = await request(app).post('/api/jobs').send({ job, resumeId: original.id });
    const second = await request(app).post('/api/jobs').send({ job: { ...job, company: 'Another Company' }, resumeId: original.id });
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    const state = (await request(app).get('/api/state')).body;
    expect(state.jobs.map((j: any) => j.resumeId)).toEqual([original.id, original.id]);
    expect(state.jobs[0].description).toBe(job.description);
    expect(state.resumes).toHaveLength(1); expect(state.resumes[0].latex).toBe(original.latex);
  });
  it('does not create an application or fake resume when OpenRouter is unconfigured', async () => {
    const { app, store } = await setup();
    const response = await request(app).post('/api/tailor').send({ job });
    expect(response.status).toBe(400); expect(response.body.error).toContain('OpenRouter');
    expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
  });
  it('redacts persisted secrets from state and backup exports', async () => {
    const { app } = await setup();
    const saved = await request(app).put('/api/settings').send({ apiKey: 'sk-secret-123456', model: 'test/model' });
    expect(saved.status).toBe(200); expect(saved.body.apiKeyConfigured).toBe(true);
    expect((await request(app).get('/api/state')).text).not.toContain('sk-secret-123456');
    expect((await request(app).get('/api/export')).text).not.toContain('sk-secret-123456');
  });
  it('rejects hostile hosts, cross-origin writes, and invalid profile data', async () => {
    const { app, store } = await setup();
    expect((await request(app).get('/api/state').set('Host', 'attacker.example')).status).toBe(403);
    expect((await request(app).put('/api/profile').set('Origin', 'https://attacker.example').send(store.state().profile)).status).toBe(403);
    expect((await request(app).put('/api/profile').send({ contact: {} })).status).toBe(400);
  });
  it('rebuilds missing PDF artifacts after restoring a backup marked ready', async () => {
    const { store } = await setup();
    // Express rejects hidden parent directories by default, even for valid PDFs.
    const hiddenDir = join(store.dir, '.restored-workspace');
    await mkdir(hiddenDir);
    const restoredStore = await Store.open(hiddenDir);
    const original = restoredStore.state().resumes[0];
    await restoredStore.update(state => { state.resumes[0].pdf = { status: 'ready', pages: 1, message: 'Restored metadata', warnings: [] }; });
    const app = createApp(restoredStore, { compile: async (dataDir, id) => {
      const path = artifactPath(dataDir, id);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, '%PDF-1.4\nrebuilt-artifact');
      return { status: 'ready', pages: 1, message: 'Rebuilt from stored source', warnings: [] };
    } });
    const response = await request(app).get(`/api/resumes/${original.id}/pdf`);
    expect(response.body.error).toBeUndefined();
    expect(response.status).toBe(200); expect(response.body.toString()).toContain('rebuilt-artifact');
    expect(restoredStore.state().resumes[0].pdf.message).toBe('Rebuilt from stored source');
  });
});
