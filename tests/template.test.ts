import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getEvidence, seedProfile } from '../server/seed.js';
import { extractTemplate, renderTemplate } from '../server/template.js';
import type { Edit, ResumeTemplate, TextSlot } from '../shared/types.js';

const baseline = readFileSync(fileURLToPath(new URL('../templates/nicholas.tex', import.meta.url)), 'utf8');
const makeEdit = (slot: TextSlot, text: string): Edit => ({ slotId: slot.id, text, reason: 'Focus on relevant evidence', evidenceIds: [] });
const getTemplate = (): ResumeTemplate => extractTemplate(baseline, 'Nicholas resume');

describe('fixed LaTeX template', () => {
  it('renders an imported resume without edits byte for byte', () => {
    expect(renderTemplate(getTemplate(), [])).toBe(baseline);
  });

  it('exposes only approved bullet prose and technologies, preserving bold command boundaries', () => {
    const template = getTemplate();
    expect(template.slots).toHaveLength(21);
    expect(template.slots.filter(slot => slot.section === 'Technologies').map(slot => slot.original)).toEqual([
      'C#, Java, Python, TypeScript, JavaScript',
      '.NET, Spring Boot, React, Next.js, Vue.js, Express',
      'AWS, AWS CDK, Docker, RabbitMQ, Kong',
      'MySQL, MongoDB, DynamoDB, Supabase, Git, SSMS, Tableau',
    ]);
    const boldContent = template.slots.find(slot => slot.original === '.NET MVC');
    expect(boldContent).toMatchObject({ section: 'Experience', group: 'experience.ncs' });
    expect(baseline.slice(boldContent!.start - 8, boldContent!.start)).toBe('\\textbf{');
    expect(baseline[boldContent!.end]).toBe('}');
    expect(template.slots.every(slot => !['Education', 'Certifications'].includes(slot.section))).toBe(true);
  });

  it('preserves every byte outside the edited span including list layout and CRLFs', () => {
    const template = getTemplate();
    const slot = template.slots.find(slot => slot.original.startsWith('Built an API observability'))!;
    expect(slot).toBeDefined();
    const text = 'Built an API observability dashboard using DynamoDB audit records.';
    const rendered = renderTemplate(template, [makeEdit(slot, text)]);
    expect(rendered).toBe(baseline.slice(0, slot.start) + text + baseline.slice(slot.end));
  });

  it('escapes TeX control characters while preserving Unicode prose', () => {
    const template = getTemplate();
    const slot = template.slots.find(slot => slot.original.startsWith('Built an API observability'))!;
    expect(slot).toBeDefined();
    const rendered = renderTemplate(template, [makeEdit(slot, 'C# & 20%_ {x} $5 ~ ^ \\ café — 数据')]);
    expect(rendered.slice(slot.start, rendered.indexOf(baseline.slice(slot.end, slot.end + 20), slot.start))).toBe(
      'C\\# \\& 20\\%\\_ \\{x\\} \\$5 \\textasciitilde{} \\textasciicircum{} \\textbackslash{} café — 数据',
    );
  });

  it('does not absorb technology line breaks or comments into editable values', () => {
    const source = baseline.replace('C\\#, Java, Python, TypeScript, JavaScript \\\\', 'C\\#, Java, Python, TypeScript, JavaScript \\\\ % fixed trailing comment');
    const template = extractTemplate(source, 'With comments');
    const slot = template.slots.find(slot => slot.group === 'skills.languages')!;
    expect(slot).toBeDefined();
    const rendered = renderTemplate(template, [makeEdit(slot, 'C#, Python')]);
    expect(rendered).toContain('\\textbf{Languages:} C\\#, Python \\\\ % fixed trailing comment');
  });

  it('decodes adjacent literal backslash and tilde glyphs without interpreting them twice', () => {
    const source = baseline.replace(
      'Built an API observability dashboard backed by DynamoDB audit logs, surfacing request volume and p95/p99 latency metrics for data producers to monitor API usage and performance.',
      'Documented \\textbackslash{}\\textasciitilde{} conventions with 20\\% C\\#.',
    );
    const template = extractTemplate(source, 'Escaped prose');
    const slot = template.slots.find(item => item.original.startsWith('Documented'))!;
    expect(slot.original).toBe('Documented \\~ conventions with 20% C#.');
    expect(renderTemplate(template, [makeEdit(slot, slot.original)])).toBe(source);
  });

  it('rejects unknown or duplicate edit IDs instead of silently dropping edits', () => {
    const template = getTemplate();
    expect(() => renderTemplate(template, [{ slotId: 'unknown', text: 'x', reason: '', evidenceIds: [] }])).toThrow(/unknown/i);
    expect(template.slots.length).toBeGreaterThan(0);
    const edit = makeEdit(template.slots[0], template.slots[0].original);
    expect(() => renderTemplate(template, [edit, edit])).toThrow(/duplicate/i);
  });

  it('rejects content that could create extra paragraphs or exceed its budget', () => {
    const template = getTemplate();
    expect(template.slots.length).toBeGreaterThan(0);
    const slot = template.slots[0];
    expect(() => renderTemplate(template, [makeEdit(slot, 'One line\n\nAnother paragraph')])).toThrow(/line|control/i);
    expect(() => renderTemplate(template, [makeEdit(slot, 'x'.repeat(slot.maxChars + 1))])).toThrow(/length|long|limit/i);
  });

  it('rejects tampered source or slot boundaries before rendering', () => {
    const template = getTemplate();
    expect(() => renderTemplate({ ...template, source: baseline + '\nmalicious' }, [])).toThrow(/hash|modified|integrity/i);
    expect(template.slots.length).toBeGreaterThan(0);
    const slot = template.slots[0];
    const corrupted = { ...template, slots: [{ ...slot, start: 0 }] };
    expect(() => renderTemplate(corrupted, [makeEdit(slot, 'changed')])).toThrow(/slot|integrity|modified/i);
  });

  it.each([
    ['shell execution', '\\immediate\\write18{touch owned}'],
    ['file reads', '\\input{private.txt}'],
    ['unsafe packages', '\\usepackage{shellesc}'],
    ['control-sequence construction', '\\csname input\\endcsname{private.txt}'],
    ['TeX caret decoding', '^^5cinput{private.txt}'],
  ])('rejects unsafe imports containing %s', (_label, injected) => {
    expect(() => extractTemplate(baseline.replace('\\begin{document}', injected + '\n\\begin{document}'), 'Unsafe')).toThrow(/unsafe|unsupported|preamble/i);
    expect(() => extractTemplate(baseline.replace('\\section{Experience}', injected + '\n\\section{Experience}'), 'Unsafe body')).toThrow(/unsafe|unsupported/i);
  });

  it('rejects unsupported layouts and oversized imports', () => {
    expect(() => extractTemplate(baseline.replace('\\section{Experience}', '\\begin{minipage}{\\textwidth}\\section{Experience}\\end{minipage}'), 'Unsupported')).toThrow(/unsupported|structure|environment/i);
    expect(() => extractTemplate(baseline + ' '.repeat(200_001), 'Oversized')).toThrow(/size|large|limit/i);
  });

  it('keeps stable IDs but distinguishes imported roles that are absent from the factual profile', () => {
    const first = getTemplate();
    const repeat = getTemplate();
    expect(first.slots.length).toBeGreaterThan(0);
    expect(first.slots.map(slot => slot.id)).toEqual(repeat.slots.map(slot => slot.id));
    const differentCompany = extractTemplate(baseline.replace('Software Engineer Intern, GovTech', 'Software Engineer Intern, ExampleCorp'), 'Different company');
    const govtechSlot = first.slots.find(slot => slot.original.startsWith('Built an API observability'))!;
    const importedSlot = differentCompany.slots.find(slot => slot.original.startsWith('Built an API observability'))!;
    expect(govtechSlot.group).toBe('experience.govtech');
    expect(importedSlot.group).not.toBe('experience.govtech');
  });

  it('binds a renamed employer to the saved profile and renders against its import snapshot', () => {
    const profile = structuredClone(seedProfile);
    profile.experience[0].company = 'ExampleCo';
    const source = baseline.replace('Software Engineer Intern, GovTech', 'Software Engineer Intern, ExampleCo');
    const template = extractTemplate(source, 'Updated employer', profile);
    const slot = template.slots.find(item => item.original.startsWith('Built an API observability'))!;
    expect(slot.group).toBe('experience.govtech');
    expect(getEvidence(profile).find(item => item.id === 'experience.govtech.bullet.0')?.group).toBe(slot.group);
    expect(template.profileBinding?.experience[0].company).toBe('ExampleCo');
    profile.experience[0].company = 'Later profile change';
    profile.experience[0].id = 'later-id';
    expect(template.profileBinding?.experience[0].company).toBe('ExampleCo');
    expect(renderTemplate(template, [])).toBe(source);
    const text = 'Built a DynamoDB observability dashboard.';
    expect(renderTemplate(template, [makeEdit(slot, text)])).toBe(source.slice(0, slot.start) + text + source.slice(slot.end));
  });

  it('binds an additional imported role to its matching saved profile identifier', () => {
    const profile = structuredClone(seedProfile);
    profile.experience.push({
      id: 'acme', company: 'Acme', role: 'Software Engineer', dates: 'Jan 2025 – May 2025', url: '', notes: '',
      bullets: ['Developed verified Python APIs for internal teams.'],
    });
    const additionalRole = '\\textbf{Software Engineer, Acme} \\hfill Jan 2025 -- May 2025\n\n\\begin{resumeitemize}\n    \\item Developed verified Python APIs for internal teams.\n\\end{resumeitemize}\n';
    const source = baseline.replace('\\section{Experience}', '\\section{Experience}\n\n' + additionalRole);
    const template = extractTemplate(source, 'Added role', profile);
    const slot = template.slots.find(item => item.original.startsWith('Developed verified Python APIs'))!;
    expect(slot.group).toBe('experience.acme');
    expect(getEvidence(profile).find(item => item.id === 'experience.acme.bullet.0')?.group).toBe(slot.group);
    expect(renderTemplate(template, [])).toBe(source);
    expect(renderTemplate(template, [makeEdit(slot, 'Built Python APIs for internal teams.')])).toContain('\\item Built Python APIs for internal teams.');
  });

  it('binds a renamed project by its saved name while retaining the original project identifier', () => {
    const profile = structuredClone(seedProfile);
    profile.projects[0].name = 'BridgeCRM';
    const source = baseline.replace('PegasusCRM — CRM Platform', 'BridgeCRM — CRM Platform');
    const template = extractTemplate(source, 'Updated project', profile);
    const slot = template.slots.find(item => item.original.startsWith('Built a TypeScript frontend'))!;
    expect(slot.group).toBe('project.pegasuscrm');
    expect(getEvidence(profile).find(item => item.id === 'project.pegasuscrm.bullet.1')?.group).toBe(slot.group);
    expect(renderTemplate(template, [])).toBe(source);
  });

  it('binds technology rows by their original labels when saved category IDs or ordering change', () => {
    const profile = structuredClone(seedProfile);
    profile.skills[0].id = 'development-languages';
    profile.skills.reverse();
    const template = extractTemplate(baseline, 'Mapped skills', profile);
    const slot = template.slots.find(item => item.label === 'Languages')!;
    expect(slot.group).toBe('skills.development-languages');
    expect(getEvidence(profile).find(item => item.id === 'skills.development-languages')?.group).toBe(slot.group);
    expect(renderTemplate(template, [])).toBe(baseline);
  });

  it('reports the missing profile technology category instead of silently binding to seed evidence', () => {
    const profile = structuredClone(seedProfile);
    profile.skills = profile.skills.filter(category => category.name !== 'Languages');
    expect(() => extractTemplate(baseline, 'Missing saved category', profile)).toThrow(/profile.*Languages|Languages.*profile/i);
  });
});

describe('profile evidence', () => {
  it('seeds existing facts without inventing metrics', () => {
    expect(seedProfile.contact.name).toBe('Nicholas Seah');
    expect(seedProfile.experience.map(role => role.company)).toEqual(['GovTech', 'NCS PTE. LTD.']);
    expect(seedProfile.projects.map(project => project.name)).toEqual(['PegasusCRM', 'PokeSwap', 'DutyNotFree']);
    expect(seedProfile.education[0]?.details).toEqual(['GPA: 3.53/4.0', 'Second Major in Tech and Business (Product Development)']);
    expect(seedProfile.projects.find(project => project.id === 'pokeswap')?.bullets[0]).toContain('50+ concurrent card transfers');
  });

  it('produces stable bullet evidence and includes user supplied notes', () => {
    const profile = structuredClone(seedProfile);
    expect(profile.experience.length).toBeGreaterThan(0);
    profile.experience[0].notes = 'Verified additional detail: managed five encrypted sources.';
    profile.additionalEvidence = 'Won a university hackathon.';
    const evidence = getEvidence(profile);
    expect(evidence.find(item => item.id === 'experience.govtech.bullet.0')).toMatchObject({ group: 'experience.govtech', text: profile.experience[0].bullets[0] });
    expect(evidence.find(item => item.id === 'experience.govtech.notes')).toMatchObject({ group: 'experience.govtech', text: profile.experience[0].notes });
    expect(evidence.find(item => item.id === 'profile.additional')).toMatchObject({ text: profile.additionalEvidence });
    expect(evidence.find(item => item.id === 'skills.languages')).toMatchObject({ group: 'skills.languages', text: 'C#, Java, Python, TypeScript, JavaScript' });
    expect(new Set(evidence.map(item => item.id)).size).toBe(evidence.length);
  });
});
