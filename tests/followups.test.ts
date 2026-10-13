import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import type { Analysis, FollowupQuestion, FollowupRound } from '../shared/types';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const job = { company: 'Example', role: 'API Engineer', description: 'Build TypeScript APIs with contract tests.', url: '', instructions: '' };
const question: FollowupQuestion = { id: 'testing', question: 'Have you written contract tests? Describe your personal contribution and outcome.', reason: 'Clarify testing experience.', sourceQuote: 'contract tests', targetGroup: 'experience.govtech' };
const analysis: Analysis = { summary: 'Relevant API evidence.', edits: [], requirements: [], gaps: [], warnings: [], reuseSuggestion: null };
const ready = { status: 'ready' as const, pages: 1, warnings: [], message: 'Verified one page' };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nomoreats-followups-')); dirs.push(dir);
  const store = await Store.open(dir); await store.saveSettings({ apiKey: 'sk-fixture-only', model: 'test/model' });
  return { store, app: createApp(store, { ask: async () => [question], generate: async () => analysis, compile: async () => ready }) };
}
const answer = { questionId: 'testing', text: 'I built contract tests for TypeScript APIs and added CI checks.', group: 'experience.govtech' };

describe('job follow-up conversation', () => {
  it('refines a resume created through the remote evidence-review flow without replacing that flow', async () => {
    const { store } = await fixture();
    const app = createApp(store, {
      analyze: async () => ({ summary: 'Current evidence is sufficient.', questions: [] }),
      ask: async () => [question], generate: async () => analysis, compile: async () => ready,
    });
    const review = await request(app).post('/api/evidence/analyze').send({ job });
    expect(review.status).toBe(200);
    const unreviewed = await request(app).post('/api/tailor').send({ job, reviewId: review.body.reviewId });
    expect(unreviewed.status).toBe(409);
    const confirmed = await request(app).post('/api/evidence/save').send({ job, reviewId: review.body.reviewId, answers: [] });
    expect(confirmed.status).toBe(200);
    const initial = await request(app).post('/api/tailor').send({ job, reviewId: review.body.reviewId });
    expect(initial.status).toBe(201);
    const jobId = initial.body.job.id;
    await request(app).patch(`/api/jobs/${jobId}`).send({ status: 'Interviewing' });
    const asked = await request(app).post('/api/followups').send({ job, jobId, resumeId: initial.body.resume.id });
    expect(asked.status).toBe(201);
    const saved = await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    expect(saved.status).toBe(200);
    const improved = await request(app).post('/api/tailor').send({ job, jobId, followupId: asked.body.id });
    expect(improved.status).toBe(201);
    expect(improved.body.job).toMatchObject({ id: jobId, status: 'Interviewing', resumeHistory: [initial.body.resume.id] });
    expect(store.state().jobs).toHaveLength(1);
    const staleReview = await request(app).post('/api/tailor').send({ job, reviewId: review.body.reviewId });
    expect(staleReview.status).toBe(409);
  });

  it('persists grounded questions and exact attributed answers across reload without adding question assumptions', async () => {
    const { store, app } = await fixture();
    const asked = await request(app).post('/api/followups').send({ job });
    expect(asked.status).toBe(201);
    expect(asked.body.questions).toEqual([question]);
    const saved = await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    expect(saved.status).toBe(200);
    const notes = saved.body.profile.experience.find((role: any) => role.id === 'govtech').notes;
    expect(notes).toContain(answer.text);
    expect(notes).not.toContain(question.question);
    const reloaded = await Store.open(store.dir);
    expect(reloaded.state().followups?.[0].answers).toEqual([answer]);
    expect(reloaded.state().profile.experience[0].notes).toContain(answer.text);
    const repeated = await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    expect(repeated.status).toBe(200);
    expect(repeated.body.profile.experience[0].notes).toBe(notes);
  });

  it('regenerates the same application with the new evidence and transcript while preserving previous versions and status', async () => {
    const { store, app } = await fixture();
    const initial = await request(app).post('/api/tailor').send({ job, forceNew: true });
    const jobId = initial.body.job.id;
    await request(app).patch(`/api/jobs/${jobId}`).send({ status: 'Applied' });
    const prior = store.state().resumes.find(resume => resume.id === initial.body.resume.id)!;
    const asked = await request(app).post('/api/followups').send({ job, jobId, resumeId: prior.id });
    await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    let received: any;
    const continuingApp = createApp(store, { generate: async options => { received = options; return analysis; }, compile: async () => ready });
    const result = await request(continuingApp).post('/api/tailor').send({ job, followupId: asked.body.id, jobId });
    expect(result.status).toBe(201);
    expect(result.body.job).toMatchObject({ id: jobId, status: 'Applied', resumeId: result.body.resume.id, resumeHistory: [prior.id] });
    expect(received).toMatchObject({ forceNew: true, candidates: [], job });
    expect(received.evidence.some((fact: any) => fact.group === answer.group && fact.text.includes(answer.text))).toBe(true);
    expect(received.followupHistory[0].answers).toEqual([answer]);
    expect(store.state().resumes.find(resume => resume.id === prior.id)).toEqual(prior);
    expect(store.state().jobs).toHaveLength(1);
    expect(store.state().followups?.[0].generatedResumeId).toBe(result.body.resume.id);
    const again = await request(continuingApp).post('/api/tailor').send({ job, followupId: asked.body.id, jobId });
    expect(again.status).toBe(200);
    expect(again.body.resume.id).toBe(result.body.resume.id);
    expect(store.state().resumes).toHaveLength(3);
  });

  it('keeps saved answers and the active resume after generation failure, then supports a retry', async () => {
    const { store, app } = await fixture();
    const first = await request(app).post('/api/tailor').send({ job, forceNew: true });
    const asked = await request(app).post('/api/followups').send({ job, jobId: first.body.job.id, resumeId: first.body.resume.id });
    await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    const failureApp = createApp(store, { generate: async () => { throw new Error('Provider unavailable'); } });
    const failed = await request(failureApp).post('/api/tailor').send({ job, followupId: asked.body.id });
    expect(failed.status).toBe(400);
    expect(store.state().profile.experience[0].notes).toContain(answer.text);
    expect(store.state().jobs[0].resumeId).toBe(first.body.resume.id);
    expect(store.state().resumes).toHaveLength(2);
    const retry = await request(app).post('/api/tailor').send({ job, followupId: asked.body.id });
    expect(retry.status).toBe(201);
    expect(store.state().jobs).toHaveLength(1);
  });

  it('rejects unknown questions, nonexistent attribution groups, and blank submissions without altering the profile', async () => {
    const { store, app } = await fixture();
    const asked = await request(app).post('/api/followups').send({ job });
    const before = store.state().profile;
    for (const answers of [[{ ...answer, questionId: 'unknown' }], [{ ...answer, group: 'experience.missing' }], [{ ...answer, text: '   ' }], [answer, answer]]) {
      const result = await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers });
      expect(result.status).toBe(400);
      expect(store.state().profile).toEqual(before);
    }
  });

  it('rejects an unanswered or different-job conversation before generation', async () => {
    const { store, app } = await fixture();
    const asked = await request(app).post('/api/followups').send({ job });
    const pending = await request(app).post('/api/tailor').send({ job, followupId: asked.body.id });
    expect(pending.status).toBe(400);
    await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    const mismatch = await request(app).post('/api/tailor').send({ job: { ...job, company: 'Other Company' }, followupId: asked.body.id });
    expect(mismatch.status).toBe(400);
    expect(store.state().jobs).toHaveLength(0);
  });

  it('sends prior answers into the next round and allows fresh clarifying questions for the latest version', async () => {
    const { store, app } = await fixture();
    const first = await request(app).post('/api/followups').send({ job });
    await request(app).post(`/api/followups/${first.body.id}/answers`).send({ answers: [answer] });
    const generated = await request(app).post('/api/tailor').send({ job, followupId: first.body.id });
    let history: FollowupRound[] = [];
    const nextApp = createApp(store, { ask: async options => { history = options.history; return [{ ...question, id: 'outcome', question: 'What outcome did those tests produce?' }]; } });
    const next = await request(nextApp).post('/api/followups').send({ job, jobId: generated.body.job.id, resumeId: generated.body.resume.id });
    expect(next.status).toBe(201);
    expect(history[0].answers).toEqual([answer]);
    expect(next.body.id).not.toBe(first.body.id);
    expect(next.body.questions[0].id).toBe('outcome');
  });

  it('rejects oversized follow-up revisions while retaining saved answers and the existing application', async () => {
    const { store, app } = await fixture();
    const initial = await request(app).post('/api/tailor').send({ job });
    const asked = await request(app).post('/api/followups').send({ job, jobId: initial.body.job.id, resumeId: initial.body.resume.id });
    await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    const oversize = createApp(store, { generate: async () => analysis, compile: async () => ({ status: 'overflow', pages: 2, message: 'Too long', warnings: [] }) });
    const rejected = await request(oversize).post('/api/tailor').send({ job, followupId: asked.body.id });
    expect(rejected.status).toBe(422);
    expect(store.state().resumes).toHaveLength(2);
    expect(store.state().jobs[0].resumeId).toBe(initial.body.resume.id);
    expect(store.state().followups?.[0].generatedResumeId).toBeUndefined();
    expect(store.state().profile.experience[0].notes).toContain(answer.text);
  });

  it('appends to the latest profile and stores only selected answers with their chosen destinations', async () => {
    const { store } = await fixture();
    const app = createApp(store, { ask: async () => [question, { ...question, id: 'deployment', question: 'How did you deploy it?' }] });
    const asked = await request(app).post('/api/followups').send({ job });
    const profile = store.state().profile;
    profile.projects[0].notes = 'An existing project fact added after the questions were asked.';
    profile.contact.location = 'Existing location edit';
    await store.saveProfile(profile);
    const saved = await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [{ ...answer, group: `project.${profile.projects[0].id}` }] });
    expect(saved.status).toBe(200);
    expect(saved.body.profile.projects[0].notes).toContain(profile.projects[0].notes);
    expect(saved.body.profile.projects[0].notes).toContain(answer.text);
    expect(saved.body.profile.experience[0].notes).toBe(profile.experience[0].notes);
    expect(saved.body.profile.contact.location).toBe('Existing location edit');
    expect(saved.body.round.answers).toHaveLength(1);
    expect(saved.body.round.questions).toHaveLength(2);
  });

  it('preserves application status updates made while a revision is generating', async () => {
    const { store, app } = await fixture();
    const initial = await request(app).post('/api/tailor').send({ job });
    const asked = await request(app).post('/api/followups').send({ job, jobId: initial.body.job.id });
    await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    const continuing = createApp(store, { generate: async () => {
      await store.update(state => { state.jobs[0].status = 'Interviewing'; });
      return analysis;
    }, compile: async () => ready });
    const result = await request(continuing).post('/api/tailor').send({ job, followupId: asked.body.id });
    expect(result.status).toBe(201);
    expect(result.body.job.status).toBe('Interviewing');
    expect(store.state().jobs).toHaveLength(1);
  });

  it('allows skipping every question without inventing facts or changing the profile', async () => {
    const { store, app } = await fixture();
    const asked = await request(app).post('/api/followups').send({ job });
    const before = store.state().profile;
    const skipped = await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [] });
    expect(skipped.status).toBe(200);
    expect(skipped.body.round.answeredAt).toBeTruthy();
    expect(skipped.body.profile).toEqual(before);
    const generated = await request(app).post('/api/tailor').send({ job, followupId: asked.body.id });
    expect(generated.status).toBe(201);
    expect(generated.body.resume.profileSnapshot).toEqual(before);
  });

  it('preserves the exact submitted answer including its whitespace', async () => {
    const { app } = await fixture();
    const asked = await request(app).post('/api/followups').send({ job });
    const text = `  ${answer.text}\n`;
    const saved = await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [{ ...answer, text }] });
    expect(saved.status).toBe(200);
    expect(saved.body.round.answers[0].text).toBe(text);
    expect(saved.body.profile.experience[0].notes).toBe(text);
  });

  it('keeps a new initial conversation separate from an existing application with the same posting', async () => {
    const { app } = await fixture();
    const existing = await request(app).post('/api/tailor').send({ job });
    const existingRound = await request(app).post('/api/followups').send({ job, jobId: existing.body.job.id });
    const initialRound = await request(app).post('/api/followups').send({ job });
    expect(initialRound.status).toBe(201);
    expect(initialRound.body.jobId).toBeNull();
    expect(initialRound.body.id).not.toBe(existingRound.body.id);
  });

  it('reports a conflict when an old browser profile tries to overwrite newly saved answers', async () => {
    const { app, store } = await fixture();
    const stale = store.state().profile;
    const asked = await request(app).post('/api/followups').send({ job });
    await request(app).post(`/api/followups/${asked.body.id}/answers`).send({ answers: [answer] });
    stale.contact.location = 'Other window edit';
    const rejected = await request(app).put('/api/profile').send(stale);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toMatch(/reload/i);
    expect(store.state().profile.experience[0].notes).toContain(answer.text);
    expect(store.state().profile.contact.location).not.toBe('Other window edit');
  });
});
