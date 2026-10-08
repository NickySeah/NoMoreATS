import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertTemplateFacts } from '../server/consistency';
import { seedProfile } from '../server/seed';
import { extractTemplate } from '../server/template';
import type { Contact, Profile } from '../shared/types';

const source = readFileSync(new URL('../templates/nicholas.tex', import.meta.url), 'utf8');
const baseline = extractTemplate(source, 'Original');
const profileCopy = (): Profile => structuredClone(seedProfile);

describe('fixed template fact consistency', () => {
  it('accepts the original source with normalized LaTeX dashes and wrappers', () => {
    expect(assertTemplateFacts(baseline, seedProfile)).toBeUndefined();
  });

  it.each<[keyof Contact, string]>([
    ['name', 'Alex Seah'], ['email', 'updated@example.com'], ['phone', '(+65) 90000000'],
    ['location', 'London'], ['website', 'https://new-portfolio.example.com/'],
    ['linkedin', 'https://linkedin.com/in/updated'], ['github', 'https://github.com/updated'],
  ])('blocks a stale fixed contact %s even when the import binding contains the new value', (field, value) => {
    const profile = profileCopy();
    profile.contact[field] = value;
    const template = extractTemplate(source, 'Stale source with current binding', profile);
    expect(() => assertTemplateFacts(template, profile)).toThrow(/Reimport an updated LaTeX template/i);
  });

  it('accepts updated visible contact fields and their matching link targets in the same layout', () => {
    const profile = profileCopy();
    profile.contact = {
      name: 'Alex Seah', email: 'alex@example.com', phone: '(+65) 90000000', location: 'London',
      website: 'https://alex.example.com/', linkedin: 'https://linkedin.com/in/alex', github: 'https://github.com/alex',
    };
    const updated = source
      .replace('{\\LARGE Nicholas Seah\\par}', '{\\LARGE Alex Seah\\par}')
      .replace('Singapore \\textbar{}', 'London \\textbar{}')
      .replaceAll('nicholasseah02@gmail.com', 'alex@example.com')
      .replace('tel:+6597662050', 'tel:+6590000000').replace('(+65) 97662050', '(+65) 90000000')
      .replaceAll('nicholasseah.netlify.app', 'alex.example.com')
      .replaceAll('linkedin.com/in/nicholasseah', 'linkedin.com/in/alex')
      .replaceAll('github.com/NickySeah}', 'github.com/alex}');
    expect(() => assertTemplateFacts(extractTemplate(updated, 'Updated contacts', profile), profile)).not.toThrow();
  });

  it('blocks a stale phone link when the visible phone number was updated', () => {
    const profile = profileCopy();
    profile.contact.phone = '(+65) 90000000';
    const updated = source.replace('(+65) 97662050', '(+65) 90000000');
    expect(() => assertTemplateFacts(extractTemplate(updated, 'Stale tel link', profile), profile)).toThrow(/phone|link/i);
  });

  it.each(['company', 'role', 'dates', 'url'] as const)('blocks stale fixed experience %s', field => {
    const profile = profileCopy();
    profile.experience[0][field] = field === 'url' ? 'https://new-employer.example.com/' : 'Changed value';
    expect(() => assertTemplateFacts(baseline, profile)).toThrow(/Reimport an updated LaTeX template/i);
  });

  it('checks dates on the corresponding role instead of finding another role’s dates', () => {
    const profile = profileCopy();
    profile.experience[0].dates = profile.experience[1].dates;
    expect(() => assertTemplateFacts(baseline, profile)).toThrow(/dates/i);
  });

  it('accepts a renamed company when the actual source heading was updated', () => {
    const profile = profileCopy();
    profile.experience[0].company = 'ExampleCo';
    const updated = source.replace('Software Engineer Intern, GovTech', 'Software Engineer Intern, ExampleCo');
    expect(() => assertTemplateFacts(extractTemplate(updated, 'Renamed company', profile), profile)).not.toThrow();
  });

  it.each(['name', 'technologies', 'url'] as const)('blocks stale fixed project %s', field => {
    const profile = profileCopy();
    profile.projects[0][field] = field === 'url' ? 'https://github.com/example/updated' : 'Changed value';
    expect(() => assertTemplateFacts(baseline, profile)).toThrow(/Reimport an updated LaTeX template/i);
  });

  it('accepts updated project headings with escaped technologies', () => {
    const profile = profileCopy();
    profile.projects[0].name = 'BridgeCRM';
    profile.projects[0].technologies = 'C#, TypeScript';
    const updated = source.replace('PegasusCRM — CRM Platform', 'BridgeCRM — CRM Platform')
      .replace('TypeScript, AWS Amplify, Cognito, Lambda}', 'C\\#, TypeScript}');
    expect(() => assertTemplateFacts(extractTemplate(updated, 'Updated project', profile), profile)).not.toThrow();
  });

  it.each(['school', 'degree', 'dates', 'details'] as const)('blocks stale fixed education %s', field => {
    const profile = profileCopy();
    if (field === 'details') profile.education[0].details[0] = 'GPA: 3.90/4.0';
    else profile.education[0][field] = 'Changed value';
    expect(() => assertTemplateFacts(baseline, profile)).toThrow(/Reimport an updated LaTeX template/i);
  });

  it.each(['name', 'issuer', 'url'] as const)('blocks stale fixed certification %s', field => {
    const profile = profileCopy();
    profile.certifications[0][field] = field === 'url' ? 'https://new-certificate.example.com/' : 'Changed value';
    expect(() => assertTemplateFacts(baseline, profile)).toThrow(/Reimport an updated LaTeX template/i);
  });

  it.each(['experience', 'projects', 'education', 'certifications'] as const)('blocks removal of a %s record still present in the template', collection => {
    const profile = profileCopy();
    profile[collection].shift();
    expect(() => assertTemplateFacts(baseline, profile)).toThrow(/Reimport an updated LaTeX template/i);
  });

  it('allows editable evidence changes and extra records that are absent from the current template', () => {
    const profile = profileCopy();
    profile.summary = 'Updated evidence summary';
    profile.additionalEvidence = 'A verified additional achievement';
    profile.experience[0].notes = 'More detail';
    profile.experience[0].bullets[0] = 'New verified contribution';
    profile.projects[0].bullets[0] = 'Revised verified project contribution';
    profile.skills[0].items = 'TypeScript, Python';
    profile.skills[0].id = 'development-languages';
    profile.skills.reverse();
    profile.experience.push({ ...profile.experience[0], id: 'extra-role', company: 'Additional employer' });
    profile.projects.push({ ...profile.projects[0], id: 'extra-project', name: 'Additional project' });
    profile.education.push({ ...profile.education[0], id: 'extra-education', school: 'Additional university' });
    profile.certifications.push({ ...profile.certifications[0], id: 'extra-certification', name: 'Additional certification' });
    expect(() => assertTemplateFacts(baseline, profile)).not.toThrow();
  });

  it('does not accept stale source facts merely because the new value appears in a comment', () => {
    const profile = profileCopy();
    profile.contact.email = 'updated@example.com';
    const template = extractTemplate(source + '\n% updated@example.com\n', 'Commented new fact', profile);
    expect(() => assertTemplateFacts(template, profile)).toThrow(/email/i);
  });
});
