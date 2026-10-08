import type { Profile, ResumeTemplate } from '../shared/types.js';
import { seedProfile } from './seed';
import { renderTemplate } from './template';

function stale(detail: string): never {
  throw new Error(`Reimport an updated LaTeX template that matches your saved profile. ${detail}`);
}

function maskComments(source: string): string {
  const chars = source.split('');
  for (let cursor = 0; cursor < source.length; cursor++) {
    if (source[cursor] === '\\') { cursor++; continue; }
    if (source[cursor] !== '%') continue;
    while (cursor < source.length && !'\r\n'.includes(source[cursor])) chars[cursor++] = ' ';
  }
  return chars.join('');
}

function groupAt(source: string, start: number): { text: string; after: number } {
  if (source[start] !== '{') stale('A fixed field has an unsupported LaTeX argument.');
  let depth = 1;
  for (let cursor = start + 1; cursor < source.length; cursor++) {
    if (source[cursor] === '\\') { cursor++; continue; }
    if (source[cursor] === '{') depth++;
    if (source[cursor] === '}' && --depth === 0) return { text: source.slice(start + 1, cursor), after: cursor + 1 };
  }
  stale('A fixed field has unbalanced LaTeX braces.');
}

/** Decode visible text structurally so URL targets or comments cannot satisfy it. */
function plain(source: string): string {
  let result = '';
  for (let cursor = 0; cursor < source.length; cursor++) {
    if (source[cursor] === '{') {
      const group = groupAt(source, cursor);
      result += plain(group.text);
      cursor = group.after - 1;
      continue;
    }
    if (source[cursor] !== '\\') { result += source[cursor]; continue; }
    const command = /^\\([A-Za-z]+|.)/u.exec(source.slice(cursor));
    if (!command) stale('A fixed field has an incomplete LaTeX command.');
    const name = command[1];
    let after = cursor + command[0].length;
    if (name.length === 1) result += name === '\\' ? ' ' : name;
    else if (name === 'textbf') {
      const group = groupAt(source, after);
      result += plain(group.text);
      after = group.after;
    } else if (name === 'href') {
      const target = groupAt(source, after);
      const label = groupAt(source, target.after);
      result += plain(label.text);
      after = label.after;
    } else if (['textbackslash', 'textasciitilde', 'textasciicircum', 'textbar'].includes(name)) {
      const group = groupAt(source, after);
      result += ({ textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textbar: '|' } as Record<string, string>)[name];
      after = group.after;
    } else if (['vspace', 'begin', 'end'].includes(name)) {
      after = groupAt(source, after).after;
    } else if (['LARGE', 'par', 'item'].includes(name)) result += ' ';
    else stale(`The fixed text contains an unsupported command: \\${name}.`);
    cursor = after - 1;
  }
  return result;
}

function normalized(value: string): string {
  return value.normalize('NFC').replace(/---|--|[–—]/g, ' – ').replace(/\s+-\s+/g, ' – ')
    .replace(/\s*,\s*/g, ', ').replace(/\s+/gu, ' ').trim();
}

function same(actual: string, expected: string, field: string): void {
  if (normalized(actual) !== normalized(expected)) stale(`The fixed ${field} no longer matches your profile.`);
}

function links(source: string): Array<{ target: string; label: string }> {
  return [...source.matchAll(/\\href/g)].map(match => {
    const target = groupAt(source, match.index! + match[0].length);
    const label = groupAt(source, target.after);
    return { target: plain(target.text).trim(), label: plain(label.text).trim() };
  });
}

function url(value: string): string {
  if (!value.trim()) return '';
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/u, '')}${parsed.search}${parsed.hash}`;
  } catch {
    return value.trim().replace(/\/+$/u, '');
  }
}

function sameUrl(actual: string, expected: string, field: string): void {
  if (url(actual) !== url(expected)) stale(`The fixed ${field} link no longer matches your profile.`);
}

interface Entry { heading: string; content: string; start: number; end: number }

function sections(source: string): Map<string, { text: string; start: number }> {
  const matches = [...source.matchAll(/\\section\{([^{}]+)\}/g)];
  return new Map(matches.map((match, index) => {
    const start = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? source.indexOf('\\end{document}', start);
    return [match[1], { text: source.slice(start, end), start }];
  }));
}

function entries(section: { text: string; start: number }): Entry[] {
  const result: Entry[] = [];
  let previousEnd = 0;
  for (const block of section.text.matchAll(/\\begin\{resumeitemize\}([\s\S]*?)\\end\{resumeitemize\}/g)) {
    const blockStart = block.index!;
    const start = section.start + blockStart + '\\begin{resumeitemize}'.length;
    result.push({ heading: section.text.slice(previousEnd, blockStart).trim(), content: block[1], start, end: start + block[1].length });
    previousEnd = blockStart + block[0].length;
  }
  return result;
}

function headingParts(heading: string, field: string): { left: string; right: string } {
  const parts = heading.split('\\hfill');
  if (parts.length !== 2) stale(`The fixed ${field} heading cannot be matched to your profile.`);
  return { left: plain(parts[0]), right: plain(parts[1]) };
}

function record<T extends { id: string }>(
  actual: string, binding: T[], current: T[], signature: (item: T) => string, field: string, boundId?: string,
): T {
  const bound = boundId ? binding.find(item => item.id === boundId) : binding.find(item => normalized(signature(item)) === normalized(actual));
  const item = bound ? current.find(item => item.id === bound.id) : current.find(item => normalized(signature(item)) === normalized(actual));
  if (!item) stale(`A fixed ${field} record in the template was removed or changed in your profile.`);
  same(actual, signature(item), field);
  return item;
}

function slotId(template: ResumeTemplate, entry: Entry, prefix: string): string | undefined {
  const group = template.slots.find(slot => slot.start >= entry.start && slot.start < entry.end)?.group;
  return group?.startsWith(prefix) && !group.startsWith(`${prefix}imported-`) ? group.slice(prefix.length) : undefined;
}

function assertContacts(source: string, profile: Profile): void {
  const center = /\\begin\{center\}([\s\S]*?)\\end\{center\}/u.exec(source)?.[1];
  if (!center) stale('The fixed contact header cannot be found.');
  const name = /\{\\LARGE\s+([\s\S]*?)\\par\}/u.exec(center);
  if (!name) stale('The fixed contact name cannot be found.');
  same(plain(name[1]), profile.contact.name, 'contact name');
  const pieces = center.replace(name[0], '').replace(/\\vspace\{[^{}]+\}/g, '').trim().split('\\textbar{}');
  if (pieces.length !== 6) stale('The fixed contact fields must retain the supported six-field layout.');
  same(plain(pieces[0]), profile.contact.location, 'contact location');
  const contactLinks = pieces.slice(1).map(piece => {
    const found = links(piece);
    if (found.length !== 1 || normalized(plain(piece)) !== normalized(found[0].label)) stale('A fixed contact link cannot be matched.');
    return found[0];
  });
  const email = contactLinks[0];
  if (email.label.toLowerCase() !== profile.contact.email.trim().toLowerCase() ||
      email.target.toLowerCase() !== `mailto:${profile.contact.email.trim().toLowerCase()}`) stale('The fixed contact email or email link no longer matches your profile.');
  const phone = contactLinks[1];
  const digits = (value: string) => value.replace(/\D/g, '');
  if (digits(phone.label) !== digits(profile.contact.phone) || !phone.target.startsWith('tel:') || digits(phone.target.slice(4)) !== digits(profile.contact.phone)) {
    stale('The fixed contact phone number or phone link no longer matches your profile.');
  }
  (['website', 'linkedin', 'github'] as const).forEach((field, index) => {
    const link = contactLinks[index + 2];
    sameUrl(link.target, profile.contact[field], `contact ${field}`);
    const visible = (value: string) => value.trim().replace(/^https?:\/\//iu, '').replace(/\/+$/u, '');
    same(visible(link.label), visible(profile.contact[field]), `contact ${field}`);
  });
}

/** Block stale frozen facts before import or generation; editable evidence is independent. */
export function assertTemplateFacts(template: ResumeTemplate, profile: Profile): void {
  renderTemplate(template, []); // Establish supported source and untampered slot boundaries.
  const source = maskComments(template.source);
  const binding = template.profileBinding ?? seedProfile;
  assertContacts(source, profile);
  const sectionMap = sections(source);

  for (const entry of entries(sectionMap.get('Experience')!)) {
    const actual = headingParts(entry.heading, 'experience');
    const role = record(actual.left, binding.experience, profile.experience,
      item => `${item.role}, ${item.company}`, 'experience title/company', slotId(template, entry, 'experience.'));
    same(actual.right, role.dates, `${role.company} experience dates`);
    sameUrl(links(entry.heading)[0]?.target ?? '', role.url, `${role.company} experience`);
  }

  for (const entry of entries(sectionMap.get('Projects')!)) {
    const actual = plain(entry.heading);
    const titleParts = actual.split('|');
    if (titleParts.length !== 2) stale('A fixed project technology heading cannot be matched to your profile.');
    const name = normalized(titleParts[0]).split(' – ')[0];
    const project = record(name, binding.projects, profile.projects, item => item.name, 'project name', slotId(template, entry, 'project.'));
    same(titleParts[1], project.technologies, `${project.name} project technologies`);
    sameUrl(links(entry.heading)[0]?.target ?? '', project.url, `${project.name} project`);
  }

  for (const entry of entries(sectionMap.get('Education')!)) {
    const actual = headingParts(entry.heading, 'education');
    const education = record(actual.left, binding.education, profile.education,
      item => `${item.school}, ${item.degree}`, 'education school/degree');
    same(actual.right, education.dates, `${education.school} education dates`);
    const details = [...entry.content.matchAll(/^[ \t]*\\item[ \t]+([^\r\n]*)/gm)].map(match => normalized(plain(match[1])));
    if (JSON.stringify(details) !== JSON.stringify(education.details.map(normalized))) stale(`The fixed ${education.school} education details no longer match your profile.`);
  }

  for (const line of sectionMap.get('Certifications')!.text.split(/[\r\n]+/u).map(value => value.trim()).filter(Boolean)) {
    const actual = headingParts(line, 'certification');
    const certificate = record(`${normalized(actual.left)}|${normalized(actual.right)}`, binding.certifications, profile.certifications,
      item => `${item.name}|${item.issuer}`, 'certification name/issuer');
    sameUrl(links(line)[0]?.target ?? '', certificate.url, `${certificate.name} certification`);
  }
}
