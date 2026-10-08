import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import type { Analysis, PdfResult } from '../shared/types';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const job = { company: 'Example', role: 'Engineer', description: 'Build TypeScript APIs and AWS services.', url: '', instructions: '' };
const analysis: Analysis = { summary: 'Use supported API experience.', edits: [], requirements: [], gaps: [], warnings: [], reuseSuggestion: null };
const ready: PdfResult = { status: 'ready', pages: 1, message: 'Verified one page', warnings: [] };
const overflow: PdfResult = { status: 'overflow', pages: 2, message: 'Too much text', warnings: [] };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nomoreats-one-page-')); dirs.push(dir);
  const store = await Store.open(dir);
  await store.saveSettings({ apiKey: 'sk-fixture-only', model: 'test/model' });
  return store;
}

describe('one-page resume policy', () => {
  it('requests a shorter revision on overflow and saves only the verified final version', async () => {
    const store = await fixture();
    let generations = 0;
    let compilations = 0;
    const app = createApp(store, {
      generate: async options => {
        generations++;
        if (generations === 2) {
          expect(options).toMatchObject({ fitToOnePage: true, forceNew: true, candidates: [] });
          return { ...analysis, summary: 'Shortened to fit one page.' };
        }
        return analysis;
      },
      compile: async () => ++compilations === 1 ? overflow : ready,
    });
    const response = await request(app).post('/api/tailor').send({ job, forceNew: true });
    expect(response.status).toBe(201);
    expect(response.body.resume.pdf.pages).toBe(1);
    expect(response.body.analysis.summary).toBe('Shortened to fit one page.');
    expect(store.state().resumes).toHaveLength(2);
    expect(store.state().jobs).toHaveLength(1);
    expect(generations).toBe(2);
  });

  it.each([
    overflow,
    { ...ready, pages: 2 },
    { ...ready, pages: null },
    { ...ready, warnings: ['Overfull \\hbox (10pt too wide)'] },
    { status: 'unavailable', pages: null, message: 'Compiler missing', warnings: [] },
    { status: 'failed', pages: null, message: 'Compilation failed', warnings: [] },
  ] satisfies PdfResult[])('rejects an unverified or oversized result without saving a resume or application: %j', async pdf => {
    const store = await fixture();
    const app = createApp(store, { generate: async () => analysis, compile: async () => pdf });
    const response = await request(app).post('/api/tailor').send({ job, forceNew: true });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/one page|one-page/i);
    expect(store.state().resumes).toHaveLength(1);
    expect(store.state().jobs).toHaveLength(0);
  });

  it('rejects a template whose page count cannot be verified', async () => {
    const store = await fixture();
    const app = createApp(store, { compile: async () => ({ ...ready, pages: null }) });
    const template = store.state().template;
    const response = await request(app).post('/api/template').send({ source: template.source });
    expect(response.status).toBe(422);
    expect(store.state().template).toEqual(template);
  });

  it('does not link an application to a resume that fails the one-page check', async () => {
    const store = await fixture();
    const app = createApp(store, { compile: async () => overflow });
    const response = await request(app).post('/api/jobs').send({ job, resumeId: store.state().resumes[0].id });
    expect(response.status).toBe(422);
    expect(store.state().jobs).toHaveLength(0);
  });
});
