import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobHighlights } from '../src/components/JobHighlights';
import type { Analysis } from '../shared/types';

const base: Analysis = { summary: '', edits: [], requirements: [], gaps: [], warnings: [], reuseSuggestion: null };
describe('job match highlights', () => {
  it('shows related factual evidence for a partial match without claiming the criterion is fully covered', () => {
    const analysis: Analysis = { ...base, requirements: [{ term: 'API development experience', sourceQuote: 'Build production APIs', importance: 'required', covered: false, evidenceIds: ['e1'] }] };
    const html = renderToStaticMarkup(createElement(JobHighlights, { analysis, evidence: new Map([['e1', 'Built a TypeScript API dashboard.']]) }));
    expect(html).toContain('Built a TypeScript API dashboard.');
    expect(html).toContain('Partial match');
    expect(html).not.toContain('Fully supported');
  });
  it('shows a full match before a partial match and never displays unknown evidence', () => {
    const analysis: Analysis = { ...base, requirements: [
      { term: 'Team leadership', sourceQuote: 'Lead a team', importance: 'required', covered: false, evidenceIds: ['partial'] },
      { term: 'AWS', sourceQuote: 'AWS preferred', importance: 'preferred', covered: true, evidenceIds: ['full'] },
      { term: 'Unknown skill', sourceQuote: 'Unknown skill', importance: 'required', covered: true, evidenceIds: ['missing'] },
    ] };
    const html = renderToStaticMarkup(createElement(JobHighlights, { analysis, evidence: new Map([['partial', 'Coordinated a course project.'], ['full', 'Built AWS services.']]) }));
    expect(html.indexOf('Built AWS services.')).toBeLessThan(html.indexOf('Coordinated a course project.'));
    expect(html).not.toContain('Unknown skill');
    expect(html).toContain('Fully supported');
  });
});
