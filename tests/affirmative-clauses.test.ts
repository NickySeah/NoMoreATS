import { describe, expect, it } from 'vitest';
import { validateAnalysis } from '../server/ai';
import type { Analysis, Evidence, ResumeTemplate } from '../shared/types';

// Explicit local fixtures: these tests validate evidence, never call a provider.
const template: ResumeTemplate = { id: 't', name: 'Fixture', source: '', sourceHash: 'fixture', importedAt: '', baselinePages: 1, slots: [{ id: 'bullet', label: 'Bullet', section: 'Experience', original: '', start: 0, end: 0, maxChars: 150, context: 'Acme', group: 'experience.acme' }] };
const facts = (text: string): Evidence[] => [{ id: 'fact', text, group: 'experience.acme' }];
const assessment = (term: string, edit?: string): Analysis => ({ summary: 'Fixture assessment', edits: edit ? [{ slotId: 'bullet', text: edit, reason: 'Supported work', evidenceIds: ['fact'] }] : [], requirements: [{ term, sourceQuote: term, importance: 'required', evidenceIds: ['fact'], covered: true }], gaps: [], warnings: [], reuseSuggestion: null });

describe('independent affirmative evidence clauses', () => {
  it.each([
    'I deployed Docker services, but I have never used AWS.',
    'I have never used AWS, but I deployed Docker services.',
    'I deployed Docker services and I have no experience with AWS.',
    'I deployed Docker services, but no experience with AWS.',
    'I am not sure whether I used AWS, while I deployed Docker services.',
  ])('supports the affirmative Docker clause without supporting AWS: %s', text => {
    const result = validateAnalysis(assessment('Docker', 'Deployed Docker services.'), template, facts(text), [], 'Docker and AWS required.');
    expect(result.requirements[0].covered).toBe(true);
    expect(validateAnalysis(assessment('AWS'), template, facts(text), [], 'Docker and AWS required.').requirements[0].covered).toBe(false);
    expect(() => validateAnalysis(assessment('AWS', 'Deployed AWS services.'), template, facts(text), [], 'Docker and AWS required.')).toThrow(/unsupported requirement/i);
  });

  it('retains a confirmed metric but does not borrow the denied metric in another clause', () => {
    const text = 'I measured a 50% latency improvement, but there is no proof of a 20% throughput gain.';
    const output = { ...assessment('API', 'Improved latency by 50%.'), requirements: [] };
    expect(validateAnalysis(output, template, facts(text), [], '').edits[0].text).toBe('Improved latency by 50%.');
    expect(() => validateAnalysis({ ...output, edits: [{ ...output.edits[0], text: 'Improved throughput by 20%.' }] }, template, facts(text), [], '')).toThrow(/unsupported metric/i);
  });

  it('does not promote a coordinated predicate within a no-evidence denial', () => {
    const text = 'I have no evidence that I used AWS and I deployed Docker services.';
    expect(validateAnalysis(assessment('Docker'), template, facts(text), [], 'Docker').requirements[0].covered).toBe(false);
    expect(() => validateAnalysis(assessment('Docker', 'Deployed Docker services.'), template, facts(text), [], 'Docker')).toThrow(/unsupported requirement/i);
  });

  it('does not borrow a coordinated metric within a no-proof denial', () => {
    const text = 'I have no proof that I measured a 50% latency improvement and I reduced throughput by 20%.';
    const output = { ...assessment('API', 'Reduced throughput by 20%.'), requirements: [] };
    expect(() => validateAnalysis(output, template, facts(text), [], '')).toThrow(/unsupported metric/i);
  });

  it.each([
    'I have never used AWS and Docker.',
    'I have never used AWS or deployed Docker.',
    'I am not sure whether I used AWS and I deployed Docker.',
    'I have no experience with AWS, Docker, and Kubernetes.',
  ])('does not split coordinated objects or uncertain predicates into affirmative evidence: %s', text => {
    expect(validateAnalysis(assessment('Docker'), template, facts(text), [], 'Docker').requirements[0].covered).toBe(false);
  });
});
