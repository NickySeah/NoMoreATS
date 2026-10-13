import { describe, expect, it } from 'vitest';
import { tailorWithOpenRouter, validateAnalysis } from '../server/ai';
import type { Analysis, Evidence, FollowupQuestion, FollowupRound, JobInput, ResumeTemplate } from '../shared/types';

const job: JobInput = { company: 'Example', role: 'Engineer', description: 'Build TypeScript APIs. AWS production experience is preferred.', url: '', instructions: 'Emphasise supported backend work.' };
const evidence: Evidence[] = [{ id: 'experience.acme.bullet.0', text: 'Built TypeScript APIs at Acme.', group: 'experience.acme' }];
const groups = [{ id: 'experience.acme', label: 'Engineer at Acme' }];
const analysis: Analysis = { summary: 'API experience is established; AWS is not.', edits: [], requirements: [], gaps: ['Confirm any AWS production work.'], warnings: [], reuseSuggestion: null };
const question: FollowupQuestion = { id: 'aws', question: 'Have you used AWS in this role? If so, describe your contribution and outcome.', reason: 'AWS production work is not established by the current evidence.', sourceQuote: 'AWS production experience is preferred.', targetGroup: 'experience.acme' };
const history: FollowupRound[] = [{ id: 'round-1', job, jobId: 'job-1', resumeId: 'resume-1', questions: [{ ...question, id: 'deployment', question: 'What deployment work did you perform at Acme?' }], answers: [{ questionId: 'deployment', text: 'I have never used AWS. I deployed a TypeScript service using Docker.', group: 'experience.acme' }], createdAt: '2026-10-08T00:00:00Z', answeredAt: '2026-10-08T00:01:00Z' }];
const template: ResumeTemplate = { id: 'template', name: 'Fixture', source: 'Built APIs.', sourceHash: 'fixture', slots: [{ id: 'bullet', label: 'Bullet', section: 'Experience', original: 'Built APIs.', start: 0, end: 11, maxChars: 100, context: 'Acme', group: 'experience.acme' }], importedAt: '', baselinePages: 1 };
const options = { key: 'sk-fixture-only', model: 'test/structured-model', privacyMode: true, job, evidence, groups, analysis, history: [] as FollowupRound[] };
const modelResponse = (value: unknown) => Response.json({ id: 'gen-followup-fixture', choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] });

async function ask(value: unknown, overrides: Partial<typeof options> = {}) {
  const { generateFollowupQuestions } = await import('../server/followup-ai');
  return generateFollowupQuestions({ ...options, ...overrides, fetcher: async () => modelResponse(value) });
}

describe('job-specific follow-up provider', () => {
  it('requests grounded structured questions with the selected job, evidence and destinations', async () => {
    const { generateFollowupQuestions } = await import('../server/followup-ai');
    let outbound: any;
    let request: RequestInit | undefined;
    const questions = await generateFollowupQuestions({ ...options, fetcher: async (url, init) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      request = init;
      outbound = JSON.parse(String(init!.body));
      return modelResponse({ questions: [question] });
    } });
    expect(questions).toEqual([question]);
    expect(outbound.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'job_followup_questions', strict: true } });
    expect(outbound.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(outbound.provider).toEqual({ require_parameters: true, data_collection: 'deny', zdr: true });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(outbound.messages[1].content);
    expect(payload).toMatchObject({ job, evidence, groups, analysis, history: [] });
    expect(outbound.messages[1].content).not.toContain('sk-fixture-only');
    expect(outbound.messages[0].content).toMatch(/neutral/i);
    expect(outbound.messages[0].content).toMatch(/do not assume/i);
  });

  it('includes prior exact answers while excluding unrelated profile/contact properties', async () => {
    const { generateFollowupQuestions } = await import('../server/followup-ai');
    let outbound: any;
    const withPrivateExtras = history.map(round => ({ ...round, profileSnapshot: { contact: { email: 'fixture-private@example.invalid' } } }));
    await generateFollowupQuestions({ ...options, history: withPrivateExtras, fetcher: async (_url, init) => { outbound = JSON.parse(String(init!.body)); return modelResponse({ questions: [] }); } });
    const payload = JSON.parse(outbound.messages[1].content);
    expect(payload.history[0].questions[0].question).toBe('What deployment work did you perform at Acme?');
    expect(payload.history[0].answers).toEqual([{ questionId: 'deployment', text: 'I have never used AWS. I deployed a TypeScript service using Docker.', group: 'experience.acme' }]);
    expect(outbound.messages[1].content).not.toContain('fixture-private@example.invalid');
    expect(outbound.messages[0].content).toMatch(/do not repeat/i);
    expect(outbound.messages[0].content).toMatch(/unavailable|negative/i);
  });

  it('accepts whitespace-normalized literal job quotations and an unspecified destination', async () => {
    const result = await ask({ questions: [{ ...question, sourceQuote: 'AWS production\nexperience is preferred.', targetGroup: null }] });
    expect(result[0]).toMatchObject({ sourceQuote: 'AWS production\nexperience is preferred.', targetGroup: null });
  });

  it('allows zero questions when no useful unresolved facts remain', async () => {
    expect(await ask({ questions: [] })).toEqual([]);
  });

  it.each([
    ['a fabricated job quotation', { questions: [{ ...question, sourceQuote: 'Kubernetes required.' }] }, /quotation|quote/i],
    ['a case-altered quotation', { questions: [{ ...question, sourceQuote: 'aws production experience is preferred.' }] }, /quotation|quote/i],
    ['an unknown destination', { questions: [{ ...question, targetGroup: 'experience.missing' }] }, /group|destination/i],
    ['duplicate question IDs', { questions: [question, { ...question, question: 'Which AWS tools did you use?' }] }, /duplicate/i],
    ['duplicate question text', { questions: [question, { ...question, id: 'another', question: `  ${question.question.toUpperCase()}  ` }] }, /duplicate|repeat/i],
    ['more than five questions', { questions: Array.from({ length: 6 }, (_, index) => ({ ...question, id: `question-${index}`, question: `What was your contribution to activity ${index}?` })) }, /invalid|five/i],
    ['an extra response field', { questions: [question], assumedFacts: ['Used AWS'] }, /invalid/i],
    ['an extra question field', { questions: [{ ...question, answer: 'Used AWS' }] }, /invalid/i],
    ['a missing question field', { questions: [{ id: 'aws', question: question.question, sourceQuote: question.sourceQuote, targetGroup: null }] }, /invalid/i],
  ])('rejects %s', async (_label, response, message) => {
    await expect(ask(response)).rejects.toThrow(message as RegExp);
  });

  it('rejects a question already asked in an earlier round even under a new ID', async () => {
    await expect(ask({ questions: [{ ...history[0].questions[0], id: 'new-id' }] }, { history })).rejects.toThrow(/already|repeat/i);
  });

  it('uses the existing privacy opt-out and reduced DeepSeek reasoning settings', async () => {
    const { generateFollowupQuestions } = await import('../server/followup-ai');
    let outbound: any;
    await generateFollowupQuestions({ ...options, model: 'deepseek/deepseek-v4.1-flash', privacyMode: false, fetcher: async (_url, init) => { outbound = JSON.parse(String(init!.body)); return modelResponse({ questions: [] }); } });
    expect(outbound.provider).toEqual({ require_parameters: true });
    expect(outbound.reasoning).toEqual({ effort: 'low' });
    expect(outbound.max_tokens).toBeGreaterThan(9000);
  });

  it.each([
    ['insufficient credits', () => new Response('{}', { status: 402 }), /credits/i],
    ['malformed model JSON', () => Response.json({ choices: [{ message: { content: 'not-json' }, finish_reason: 'stop' }] }), /valid JSON/i],
    ['token exhaustion', () => Response.json({ id: 'gen-limited', choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }), /token limit/i],
    ['empty final output', () => Response.json({ choices: [{ message: { content: null }, finish_reason: 'stop' }] }), /no final answer/i],
  ])('reports %s through the shared provider handling', async (_label, response, message) => {
    const { generateFollowupQuestions } = await import('../server/followup-ai');
    await expect(generateFollowupQuestions({ ...options, fetcher: async () => (response as () => Response)() })).rejects.toThrow(message as RegExp);
  });

  it('redacts embedded provider details while retaining a safe request ID', async () => {
    const { generateFollowupQuestions } = await import('../server/followup-ai');
    const failure = generateFollowupQuestions({ ...options, fetcher: async () => Response.json({ id: 'gen-provider-failed', error: { code: 502, message: 'sk-fixture-only private question', metadata: { error_type: 'provider_unavailable' } } }) });
    await expect(failure).rejects.toThrow(/provider.*unavailable.*gen-provider-failed/i);
    await expect(failure).rejects.not.toThrow(/sk-fixture-only|private question/i);
  });
});

describe('tailoring with a saved conversation', () => {
  it('sends the exact answers and their groups without treating questions or negative answers as achievements', async () => {
    let outbound: any;
    const withPrivateExtras = history.map(round => ({ ...round, contact: { email: 'fixture-private@example.invalid' } }));
    await tailorWithOpenRouter({ ...options, template, candidates: [], forceNew: true, followupHistory: withPrivateExtras, fetcher: async (_url, init) => { outbound = JSON.parse(String(init!.body)); return modelResponse(analysis); } });
    const payload = JSON.parse(outbound.messages[1].content);
    expect(payload.followupHistory?.[0].answers).toEqual([{ questionId: 'deployment', text: 'I have never used AWS. I deployed a TypeScript service using Docker.', group: 'experience.acme' }]);
    expect(payload.followupHistory[0].questions[0].question).toBe('What deployment work did you perform at Acme?');
    expect(outbound.messages[1].content).not.toContain('fixture-private@example.invalid');
    expect(outbound.messages[0].content).toMatch(/questions[^.]*not[^.]*evidence/i);
    expect(outbound.messages[0].content).toMatch(/negative[^.]*unknown/i);
    expect(outbound.messages[0].content).toContain('reuseSuggestion must be null');
  });
});

describe('explicit negative and uncertain qualification evidence', () => {
  const cases = [
    ['Kubernetes', 'I have not used Kubernetes'],
    ['AWS', 'No experience with AWS'],
    ['AWS', 'I don’t have experience with AWS'],
    ['TypeScript', 'I am not sure whether I used TypeScript'],
    ['AWS', 'I can’t remember whether I used Amazon Web Services for deployments.'],
  ];
  const assessment = (term: string): Analysis => ({ ...analysis, requirements: [{ term, sourceQuote: `${term} required.`, importance: 'required', evidenceIds: ['experience.acme.bullet.0'], covered: true }] });

  it.each(cases)('marks %s incomplete when its only mention denies or questions experience', (term, text) => {
    const result = validateAnalysis(assessment(term), template, [{ ...evidence[0], text }], [], `${term} required.`);
    expect(result.requirements[0].covered).toBe(false);
    expect(result.gaps).toContain(`Confirm specific evidence for “${term}”.`);
  });

  it.each(cases)('rejects inserting %s when the cited statement only denies or questions experience', (term, text) => {
    const output = { ...assessment(term), edits: [{ slotId: 'bullet', text: `Built ${term} services.`, reason: 'Matches the job.', evidenceIds: ['experience.acme.bullet.0'] }] };
    expect(() => validateAnalysis(output, template, [{ ...evidence[0], text }], [], `${term} required.`)).toThrow(/unsupported requirement/i);
  });

  it.each([
    ['AWS', 'I had no experience with AWS previously. Built AWS services at Acme.'],
    ['TypeScript', 'No experience with AWS\nBuilt TypeScript APIs at Acme.'],
    ['AWS', 'Built Amazon Web Services deployments.\nI am not sure whether I used Kubernetes.'],
    ['AWS', 'I have not used Kubernetes.\nI built an integration using AWS.'],
    ['.NET', 'No Kubernetes experience. Built .NET APIs at Acme.'],
  ])('keeps separate positive %s statements usable in the same notes', (term, text) => {
    const output = { ...assessment(term), edits: [{ slotId: 'bullet', text: `Built ${term} services.`, reason: 'Matches the supported work.', evidenceIds: ['experience.acme.bullet.0'] }] };
    const result = validateAnalysis(output, template, [{ ...evidence[0], text }], [], `${term} required.`);
    expect(result.requirements[0].covered).toBe(true);
    expect(result.edits[0].text).toBe(`Built ${term} services.`);
  });

  it('does not turn a dotted technology name into evidence of its prefix', () => {
    const result = validateAnalysis(assessment('Node'), template, [{ ...evidence[0], text: 'Built Node.js APIs.' }], [], 'Node required.');
    expect(result.requirements[0].covered).toBe(false);
  });

  it.each([
    ['AWS', 'Deployed AWS services with no downtime.'],
    ['TypeScript', 'Built TypeScript APIs without service interruptions.'],
    ['AWS', 'AWS deployment never failed.'],
    ['AWS', 'Built AWS services that did not fail under load.'],
  ])('keeps positive %s accomplishments whose negation describes avoided failures', (term, text) => {
    const output = { ...assessment(term), edits: [{ slotId: 'bullet', text: `Built ${term} services.`, reason: 'Matches the supported work.', evidenceIds: ['experience.acme.bullet.0'] }] };
    const result = validateAnalysis(output, template, [{ ...evidence[0], text }], [], `${term} required.`);
    expect(result.requirements[0].covered).toBe(true);
    expect(result.edits[0].text).toBe(`Built ${term} services.`);
  });
});

describe('explicit negative and uncertain metric evidence', () => {
  const metricEdit: Analysis = { ...analysis, requirements: [], edits: [{ slotId: 'bullet', text: 'Improved API latency by 50%.', reason: 'Highlights a measured outcome.', evidenceIds: ['experience.acme.bullet.0'] }] };

  it.each([
    'I have no measured evidence of a 50% latency improvement.',
    'I have no evidence of a 50% latency improvement.',
    'No proof of a 50% API latency improvement.',
    'I don’t have measured evidence for a 50% latency improvement.',
    'I am not sure whether API latency improved by 50%.',
    'I am uncertain whether API latency improved by 50%.',
  ])('rejects turning a denied or uncertain number into a metric: %s', text => {
    expect(() => validateAnalysis(metricEdit, template, [{ ...evidence[0], text }], [], job.description)).toThrow(/unsupported metric/i);
  });

  it('uses a measured metric in a separate sentence without borrowing a denied metric', () => {
    const facts = [{ ...evidence[0], text: 'No measured evidence of a 20% throughput gain. Measured a 50% API latency improvement.' }];
    expect(validateAnalysis(metricEdit, template, facts, [], job.description).edits[0].text).toBe('Improved API latency by 50%.');
    const unsupported = { ...metricEdit, edits: [{ ...metricEdit.edits[0], text: 'Improved API throughput by 20%.' }] };
    expect(() => validateAnalysis(unsupported, template, facts, [], job.description)).toThrow(/unsupported metric/i);
  });

  it('keeps a positive metric in a separate cited fact after a denial without sentence punctuation', () => {
    const facts = [
      { ...evidence[0], text: 'No proof of a 20% throughput gain' },
      { id: 'experience.acme.notes', text: 'Measured a 50% API latency improvement.', group: 'experience.acme' },
    ];
    const output = { ...metricEdit, edits: [{ ...metricEdit.edits[0], evidenceIds: ['experience.acme.bullet.0', 'experience.acme.notes'] }] };
    expect(validateAnalysis(output, template, facts, [], job.description).edits[0].text).toBe('Improved API latency by 50%.');
  });

  it('retains positive measured results alongside avoided failures', () => {
    const facts = [{ ...evidence[0], text: 'Deployed AWS services with no downtime and cut API latency by 50%.' }];
    expect(validateAnalysis(metricEdit, template, facts, [], job.description).edits[0].text).toBe('Improved API latency by 50%.');
  });
});
