import { describe, expect, it } from 'vitest';
import { validateAnalysis } from '../server/ai';
import type { Analysis, Evidence, Resume, ResumeTemplate } from '../shared/types';
import { seedProfile } from '../server/seed';
const template: ResumeTemplate = { id: 't', name: 'test', source: 'source', sourceHash: 'abc', importedAt: '', baselinePages: 1, slots: [{ id: 'b1', label: 'Bullet', section: 'Experience', original: 'Built APIs.', start: 0, end: 10, maxChars: 100, context: 'GovTech', group: 'experience.govtech' }] };
const evidence: Evidence[] = [{ id: 'e1', text: 'Built APIs at GovTech.', group: 'experience.govtech' }, { id: 'e2', text: 'Managed sprints in a project.', group: 'projects.other' }];
const valid: Analysis = { summary: 'API experience fits.', edits: [{ slotId: 'b1', text: 'Developed APIs.', reason: 'Matches API work.', evidenceIds: ['e1'] }], requirements: [{ term: 'APIs', sourceQuote: 'Build APIs', importance: 'required', evidenceIds: ['e1'], covered: true }], gaps: [], warnings: [], reuseSuggestion: null };
describe('AI output boundary', () => {
  it('accepts supported edits with quoted requirements', () => { expect(validateAnalysis(valid, template, evidence, [], 'Build APIs')).toEqual(valid); });
  it('rejects unknown content slots and absent evidence references', () => {
    expect(() => validateAnalysis({ ...valid, edits: [{ ...valid.edits[0], slotId: 'preamble' }] }, template, evidence, [], 'Build APIs')).toThrow();
    expect(() => validateAnalysis({ ...valid, edits: [{ ...valid.edits[0], evidenceIds: ['invented'] }] }, template, evidence, [], 'Build APIs')).toThrow();
  });
  it('prevents moving project achievements into employment bullets', () => { expect(() => validateAnalysis({ ...valid, edits: [{ ...valid.edits[0], evidenceIds: ['e2'] }] }, template, evidence, [], 'Build APIs')).toThrow(); });
  it('rejects LaTeX commands, unsupported metrics and false job quotations', () => {
    expect(() => validateAnalysis({ ...valid, edits: [{ ...valid.edits[0], text: '\\input{secrets}' }] }, template, evidence, [], 'Build APIs')).toThrow();
    expect(() => validateAnalysis({ ...valid, edits: [{ ...valid.edits[0], text: 'Improved APIs by 80%.' }] }, template, evidence, [], 'Build APIs')).toThrow();
    expect(() => validateAnalysis({ ...valid, requirements: [{ ...valid.requirements[0], sourceQuote: 'Must know Rust' }] }, template, evidence, [], 'Build APIs')).toThrow();
  });
  it('rejects a reuse suggestion for an unknown saved resume', () => { expect(() => validateAnalysis({ ...valid, reuseSuggestion: { resumeId: 'missing', reason: 'Similar' } }, template, evidence, [], 'Build APIs')).toThrow(); });
  it('does not infer a count of 2 from a year containing that digit', () => {
    expect(() => validateAnalysis({ ...valid, edits: [{ ...valid.edits[0], text: 'Built 2 APIs.' }] }, template, [{ ...evidence[0], text: 'Built APIs at GovTech in 2026.' }], [], 'Build APIs')).toThrow('unsupported metric');
  });
  it('rejects covered technical requirements when cited facts do not support the named skill', () => {
    const invented = { ...valid, edits: [{ ...valid.edits[0], text: 'Led Kubernetes migrations.' }], requirements: [{ term: 'Kubernetes', sourceQuote: 'Kubernetes', importance: 'required' as const, evidenceIds: ['e1'], covered: true }] };
    expect(() => validateAnalysis(invented, template, evidence, [], 'Kubernetes required.')).toThrow();
  });
  it('rejects a saved candidate that contains an explicitly unsupported requirement', () => {
    const candidate: Resume = { id: 'r1', name: 'Old version', createdAt: '', kind: 'tailored', templateId: 't', templateHash: 'abc', templateSnapshot: template, profileSnapshot: seedProfile, latex: 'Led Kubernetes migrations.', analysis: { ...valid, edits: [{ ...valid.edits[0], text: 'Led Kubernetes migrations.' }] }, pdf: { status: 'ready', pages: 1, message: '', warnings: [] }, model: 'test/model' };
    const result = { ...valid, edits: [], requirements: [{ term: 'Kubernetes', sourceQuote: 'Kubernetes', importance: 'required' as const, evidenceIds: [], covered: false }], reuseSuggestion: { resumeId: 'r1', reason: 'Matches' } };
    expect(() => validateAnalysis(result, template, evidence, [candidate], 'Kubernetes required.')).toThrow();
  });
  it('does not treat JavaScript as evidence for Java', () => {
    const result = { ...valid, edits: [{ ...valid.edits[0], text: 'Built Java APIs.' }], requirements: [{ term: 'Java', sourceQuote: 'Java', importance: 'required' as const, evidenceIds: ['e1'], covered: true }] };
    expect(() => validateAnalysis(result, template, [{ ...evidence[0], text: 'Built JavaScript APIs.' }], [], 'Java required.')).toThrow();
  });
});
