import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import * as ai from '../server/ai';
import type { QuestionAnalysis } from '../shared/types';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { getEvidence } from '../shared/evidence';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const job = { company: 'Example', role: 'Engineer', description: 'Build services and own CI/CD pipelines.', url: '', instructions: '' };
const questions: QuestionAnalysis = { summary: 'Confirm deployment ownership.', questions: [{ id: 'q1', term: 'CI/CD', sourceQuote: 'own CI/CD pipelines', importance: 'required', question: 'Have you personally built CI/CD pipelines? Describe your contribution, tools and project or role.', evidenceIds: [], suggestedGroup: 'experience.govtech' }] };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nomoreats-evidence-')); dirs.push(dir);
  const store = await Store.open(dir);
  await store.saveSettings({ model: 'test/model', apiKey: 'test-fixture-key' });
  const analyze = vi.fn(async (_options: Parameters<NonNullable<NonNullable<Parameters<typeof createApp>[1]>['analyze']>>[0]) => structuredClone(questions));
  const generate = vi.fn(async () => ({ summary: 'Supported facts.', edits: [], requirements: [], gaps: [], warnings: [], reuseSuggestion: null }));
  const app = createApp(store, { analyze, generate, compile: async () => ({ status: 'ready', pages: 1, message: 'Fixture compiler', warnings: [] }) });
  return { store, app, analyze, generate };
}
describe('pre-generation evidence review', () => {
  it('asks focused questions through private structured OpenRouter output and validates model references', async () => {
    const { store } = await fixture();
    let outbound: any;
    const options = { key: 'test-fixture-key', model: 'test/model', privacyMode: true, job, evidence: getEvidence(store.state().profile), groups: [{ id: 'experience.govtech', label: 'GovTech' }] };
    const fetcher: typeof fetch = async (_url, init) => { outbound = JSON.parse(String(init!.body)); return Response.json({ choices: [{ message: { content: JSON.stringify(questions) }, finish_reason: 'stop' }] }); };
    expect(await ai.analyzeEvidenceWithOpenRouter({ ...options, fetcher })).toEqual(questions);
    expect(outbound.provider).toEqual({ require_parameters: true, data_collection: 'deny', zdr: true });
    expect(outbound.response_format.json_schema.name).toBe('evidence_questions');
    expect(outbound.messages[0].content).toMatch(/personal contribution/i);
    expect(outbound.messages[1].content).not.toContain(store.state().profile.contact.email);
    for (const question of [
      { ...questions.questions[0], sourceQuote: 'invented requirement' },
      { ...questions.questions[0], evidenceIds: ['invented'] },
      { ...questions.questions[0], suggestedGroup: 'experience.invented' },
      { ...questions.questions[0], question: '\\input{secrets}' },
    ]) expect(() => ai.validateQuestionAnalysis({ ...questions, questions: [question] }, options.evidence, options.groups, job.description)).toThrow();
    expect(() => ai.validateQuestionAnalysis({ ...questions, edits: [] }, options.evidence, options.groups, job.description)).toThrow();
  });
  it('saves explicitly confirmed facts cumulatively in their selected existing group and supports tailoring', async () => {
    const { store, app, generate } = await fixture();
    const profile = store.state().profile;
    profile.experience[0].notes = 'Previous facts.';
    await store.saveProfile(profile);
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const answer = { questionId: 'q1', disposition: 'answer', text: 'I built CI/CD pipelines using GitHub Actions for GovTech APIs.', group: 'experience.govtech' };
    const save = await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [answer] });
    expect(save.status).toBe(200);
    expect(save.body.savedCount).toBe(1);
    const saved = (await request(app).get('/api/state')).body.profile;
    expect(saved.experience[0].notes).toBe('Previous facts.\n\n' + answer.text);
    expect(getEvidence(saved)).toContainEqual({ id: 'experience.govtech.notes', group: answer.group, text: saved.experience[0].notes });
    expect((await Store.open(store.dir)).state().profile).toEqual(saved);
    const generated = await request(app).post('/api/tailor').send({ job, reviewId: save.body.reviewId });
    expect(generated.status).toBe(201);
    expect(generate).toHaveBeenCalled();
    expect(generated.body.resume.profileSnapshot.experience[0].notes).toContain(answer.text);
    const second = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const next = await request(app).post('/api/evidence/save').send({ reviewId: second.reviewId, job, answers: [{ ...answer, text: 'I added automated integration tests to the deployment pipeline.' }] });
    expect(next.status).toBe(200);
    expect(next.body.profile.experience[0].notes).toContain(answer.text);
    expect(next.body.profile.experience[0].notes).toContain('automated integration tests');
  });
  it.each([
    Response.json({ error: { message: 'Private upstream detail' } }),
    Response.json({ choices: [{ message: { content: JSON.stringify(questions) }, finish_reason: 'length' }] }),
    Response.json({ choices: [{ message: { content: null, refusal: 'Private upstream detail' } }] }),
    Response.json({ choices: [{ message: { content: 'not JSON' } }] }),
    Response.json({ choices: [{ message: { content: '' } }] }),
    new Response('{}', { status: 402 }),
  ])('rejects unusable provider analysis without leaking upstream text', async response => {
    const { store } = await fixture();
    const options = { key: 'test-fixture-key', model: 'test/model', privacyMode: true, job, evidence: getEvidence(store.state().profile), groups: [], fetcher: async () => response };
    await expect(ai.analyzeEvidenceWithOpenRouter(options)).rejects.toThrow();
    await expect(ai.analyzeEvidenceWithOpenRouter({ ...options, fetcher: async () => Response.json({ error: { message: 'Private upstream detail' } }) })).rejects.not.toThrow('Private upstream detail');
  });
  it('rejects duplicate questions and oversized analyses', async () => {
    const { store } = await fixture();
    const evidence = getEvidence(store.state().profile);
    const groups = [{ id: 'experience.govtech', label: 'GovTech' }];
    expect(() => ai.validateQuestionAnalysis({ ...questions, questions: [questions.questions[0], questions.questions[0]] }, evidence, groups, job.description)).toThrow();
    expect(() => ai.validateQuestionAnalysis({ ...questions, questions: Array(9).fill(questions.questions[0]) }, evidence, groups, job.description)).toThrow();
  });
  it('saves to projects without overwriting existing accomplishments', async () => {
    const { app, store } = await fixture();
    const project = store.state().profile.projects[0];
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const result = await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [{ questionId: 'q1', disposition: 'answer', text: 'I configured GitHub Actions CI/CD for this project.', group: `project.${project.id}` }] });
    expect(result.status).toBe(200);
    expect(result.body.profile.projects[0].bullets).toEqual(project.bullets);
    expect(result.body.profile.projects[0].notes).toContain('GitHub Actions');
  });
  it('does not append the same answers twice when save requests overlap', async () => {
    const { app, store } = await fixture();
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const body = { reviewId: review.reviewId, job, answers: [{ questionId: 'q1', disposition: 'answer', text: 'I built CI/CD with GitHub Actions.', group: 'experience.govtech' }] };
    const results = await Promise.all([request(app).post('/api/evidence/save').send(body), request(app).post('/api/evidence/save').send(body)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(store.state().profile.experience[0].notes.split(body.answers[0].text)).toHaveLength(2);
  });
  it('saves factual skill notes without overwriting skill items and allows only same-group tailoring', async () => {
    const { app, store } = await fixture();
    const skill = store.state().profile.skills[0];
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const result = await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [{ questionId: 'q1', disposition: 'answer', text: 'I used GitHub Actions for CI/CD pipelines.', group: `skills.${skill.id}` }] });
    expect(result.status).toBe(200);
    expect(result.body.profile.skills[0].items).toBe(skill.items);
    const evidence = getEvidence(result.body.profile);
    const fact = evidence.find(item => item.id === `skills.${skill.id}.notes`)!;
    const template = store.state().template;
    const slot = template.slots.find(item => item.group === `skills.${skill.id}`)!;
    const analysis = { summary: 'Confirmed tools.', edits: [{ slotId: slot.id, text: 'GitHub Actions', reason: 'Confirmed.', evidenceIds: [fact.id] }], requirements: [], gaps: [], warnings: [], reuseSuggestion: null };
    expect(ai.validateAnalysis(analysis, template, evidence, [], job.description).edits[0].evidenceIds).toEqual([fact.id]);
    expect(() => ai.validateAnalysis({ ...analysis, edits: [{ ...analysis.edits[0], slotId: template.slots[0].id }] }, template, evidence, [], job.description)).toThrow('same role');
  });
  it.each(['no-experience', 'skip'])('does not turn %s into positive evidence', async disposition => {
    const { store, app } = await fixture();
    const before = getEvidence(store.state().profile);
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const result = await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [{ questionId: 'q1', disposition, text: '', group: null }] });
    expect(result.status).toBe(200); expect(result.body.savedCount).toBe(0);
    expect(getEvidence(store.state().profile)).toEqual(before);
  });
  it('rejects stale job and profile reviews and unreviewed generation before paid calls', async () => {
    const { store, app, generate } = await fixture();
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    expect((await request(app).post('/api/tailor').send({ job, reviewId: review.reviewId })).status).toBe(409);
    const answers = [{ questionId: 'q1', disposition: 'skip', text: '', group: null }];
    expect((await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job: { ...job, role: 'Other' }, answers })).status).toBe(409);
    const profile = store.state().profile; profile.summary += ' Changed.'; await store.saveProfile(profile);
    expect((await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers })).status).toBe(409);
    expect(generate).not.toHaveBeenCalled();
  });
  it('invalidates a review when the template is reimported even with the same source', async () => {
    const { app, store } = await fixture();
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    await store.update(state => { state.template.id = 'reimported-template'; });
    const result = await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [{ questionId: 'q1', disposition: 'skip', text: '', group: null }] });
    expect(result.status).toBe(409);
  });
  it('expires abandoned reviews without losing saved profile data', async () => {
    const { app, store } = await fixture();
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const before = store.state().profile;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60 * 1000);
    try {
      expect((await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [{ questionId: 'q1', disposition: 'skip', text: '', group: null }] })).status).toBe(409);
    } finally { clock.mockRestore(); }
    expect(store.state().profile).toEqual(before);
  });
  it('handles no questions with an explicit review step and no fabricated claims', async () => {
    const { app, analyze } = await fixture();
    analyze.mockResolvedValue({ summary: 'Existing evidence is enough.', questions: [] });
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const save = await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [] });
    expect(save.status).toBe(200); expect(save.body.savedCount).toBe(0);
    expect((await request(app).post('/api/tailor').send({ job, reviewId: review.reviewId })).status).toBe(201);
  });
  it.each([
    { questionId: 'q1', disposition: 'answer', text: 'Confirmed fact.', group: 'experience.fake' },
    { questionId: 'fake', disposition: 'answer', text: 'Confirmed fact.', group: 'experience.govtech' },
    { questionId: 'q1', disposition: 'answer', text: '', group: 'experience.govtech' },
    { questionId: 'q1', disposition: 'answer', text: '\\input{fake}', group: 'experience.govtech' },
    { questionId: 'q1', disposition: 'skip', text: 'Invented positive claim.', group: null },
  ])('rejects invalid answer payload %j atomically', async answer => {
    const { app, store } = await fixture();
    const before = store.state().profile;
    const review = (await request(app).post('/api/evidence/analyze').send({ job })).body;
    const result = await request(app).post('/api/evidence/save').send({ reviewId: review.reviewId, job, answers: [answer] });
    expect(result.status).toBe(400); expect(store.state().profile).toEqual(before);
  });
  it('requires configured OpenRouter for analysis and leaves data intact on analysis errors', async () => {
    const { app, store, analyze } = await fixture();
    analyze.mockRejectedValue(new Error('Fixture analysis failed.'));
    expect((await request(app).post('/api/evidence/analyze').send({ job })).body.error).toBe('Fixture analysis failed.');
    await store.saveSettings({ clearApiKey: true });
    expect((await request(app).post('/api/evidence/analyze').send({ job })).status).toBe(400);
    expect(store.state().jobs).toHaveLength(0); expect(store.state().resumes).toHaveLength(1);
  });
  it('analyzes all current factual evidence without generating or saving a resume', async () => {
    const { store, app, analyze, generate } = await fixture();
    const profile = store.state().profile;
    profile.experience[0].notes = 'Existing factual notes.';
    await store.saveProfile(profile);
    const result = await request(app).post('/api/evidence/analyze').send({ job });
    expect(result.status).toBe(200);
    expect(result.body.questions).toEqual(questions.questions);
    expect(result.body.groups).toContainEqual({ id: 'experience.govtech', label: expect.stringContaining('GovTech') });
    expect(analyze.mock.calls[0][0].evidence).toContainEqual(expect.objectContaining({ text: 'Existing factual notes.' }));
    expect(generate).not.toHaveBeenCalled();
    expect(store.state().resumes).toHaveLength(1);
    expect(store.state().jobs).toHaveLength(0);
  });
});
