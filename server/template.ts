import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Edit, Profile, ResumeTemplate, TextSlot } from '../shared/types.js';
import { seedProfile } from './seed.js';

const MAX_SOURCE_BYTES = 200_000;
const SECTIONS = ['Education', 'Experience', 'Projects', 'Technologies', 'Certifications'];
const TECHNOLOGY_LABELS = ['Languages', 'Frameworks', 'Cloud & Infrastructure', 'Databases & Tools'];
const trustedSource = readFileSync(new URL('../templates/nicholas.tex', import.meta.url), 'utf8');
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const allowedCommands = new Set([
  'begin', 'end', 'section', 'textbf', 'href', 'textbar', 'LARGE', 'par', 'vspace', 'hfill', 'item',
  'textbackslash', 'textasciitilde', 'textasciicircum',
]);
const specialCharacters: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&',
  '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
};

/** Mask comments without changing offsets, including CRLF and Unicode offsets. */
function maskComments(source: string): string {
  const chars = source.split('');
  for (let cursor = 0; cursor < source.length; cursor++) {
    if (source[cursor] === '\\') { cursor++; continue; }
    if (source[cursor] !== '%') continue;
    while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') chars[cursor++] = ' ';
  }
  return chars.join('');
}

function normalizePreamble(source: string): string {
  // Metadata may identify a reimported resume. Its values must remain plain text.
  return maskComments(source)
    .replace(/(pdftitle|pdfauthor)=\{[^{}\\]*\}/g, '$1={IDENTITY}')
    .replace(/\s+/g, '');
}

function readGroup(code: string, start: number): { start: number; end: number; after: number; text: string } {
  if (code[start] !== '{') throw new Error('Unsupported template structure: expected a braced argument.');
  let depth = 1;
  for (let cursor = start + 1; cursor < code.length; cursor++) {
    if (code[cursor] === '\\') { cursor++; continue; }
    if (code[cursor] === '{') depth++;
    if (code[cursor] === '}' && --depth === 0) {
      return { start: start + 1, end: cursor, after: cursor + 1, text: code.slice(start + 1, cursor) };
    }
  }
  throw new Error('Unsupported template structure: unbalanced braces.');
}

function commandAt(code: string, cursor: number): { name: string; after: number } {
  const match = /^\\([A-Za-z]+|[^\r\n])/u.exec(code.slice(cursor));
  if (!match) throw new Error('Unsupported template structure: incomplete TeX command.');
  return { name: match[1], after: cursor + match[0].length };
}

function validateSource(source: string): { code: string; bodyStart: number; bodyEnd: number } {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error(`Template exceeds the source size limit of ${MAX_SOURCE_BYTES} bytes.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source) || source.includes('^^')) {
    throw new Error('Unsafe template: control characters and TeX caret decoding are unsupported.');
  }
  const code = maskComments(source);
  const bodyMarker = '\\begin{document}';
  const endingMarker = '\\end{document}';
  const bodyStart = code.indexOf(bodyMarker);
  const bodyEnd = code.indexOf(endingMarker);
  if (bodyStart < 0 || bodyEnd <= bodyStart || code.indexOf(bodyMarker, bodyStart + 1) >= 0 ||
      code.indexOf(endingMarker, bodyEnd + 1) >= 0 || code.slice(bodyEnd + endingMarker.length).trim()) {
    throw new Error('Unsupported template structure: one complete document is required.');
  }
  const trustedPreamble = trustedSource.slice(0, trustedSource.indexOf(bodyMarker));
  if (normalizePreamble(source.slice(0, bodyStart)) !== normalizePreamble(trustedPreamble)) {
    throw new Error('Unsupported or unsafe preamble. Import the existing Nicholas resume format with its original typography.');
  }

  const stack: string[] = [];
  let braceDepth = 0;
  let centers = 0;
  for (let cursor = bodyStart; cursor < code.length; cursor++) {
    if (code[cursor] === '{') { braceDepth++; continue; }
    if (code[cursor] === '}') {
      if (--braceDepth < 0) throw new Error('Unsupported template structure: unbalanced braces.');
      continue;
    }
    if (code[cursor] !== '\\') continue;
    const command = commandAt(code, cursor);
    if (command.name.length === 1 && '#%&_${}^~\\ '.includes(command.name)) {
      cursor = command.after - 1;
      continue;
    }
    if (!allowedCommands.has(command.name)) throw new Error(`Unsafe or unsupported TeX command: \\${command.name}`);
    if (command.name === 'begin' || command.name === 'end') {
      const environment = readGroup(code, command.after);
      if (!['document', 'center', 'resumeitemize'].includes(environment.text)) {
        throw new Error(`Unsupported template environment: ${environment.text}`);
      }
      if (command.name === 'begin') {
        if (environment.text === 'center') centers++;
        if (environment.text === 'resumeitemize' && stack.at(-1) !== 'document') {
          throw new Error('Unsupported template structure: nested resume lists.');
        }
        stack.push(environment.text);
      } else if (stack.pop() !== environment.text) {
        throw new Error('Unsupported template structure: unbalanced environments.');
      }
    }
    if (command.name === 'href') {
      const target = readGroup(code, command.after);
      if (!/^(https?:\/\/|mailto:|tel:)/iu.test(target.text) || /[{}\r\n]/u.test(target.text)) {
        throw new Error('Unsafe link target: only HTTP, HTTPS, email and phone links are supported.');
      }
    }
    if (command.name === 'vspace') {
      const spacing = readGroup(code, command.after);
      if (!/^[-+]?\d+(?:\.\d+)?(?:em|pt|cm)$/u.test(spacing.text)) throw new Error('Unsupported template spacing argument.');
    }
    cursor = command.after - 1;
  }
  if (braceDepth !== 0 || stack.length !== 0 || centers !== 1) throw new Error('Unsupported template structure: unbalanced or extra layout environments.');
  return { code, bodyStart, bodyEnd };
}

function decodeProse(text: string): string {
  const glyphs: Record<string, string> = { textbackslash: '\\', textasciitilde: '~', textasciicircum: '^' };
  return text.replace(/\\(textbackslash|textasciitilde|textasciicircum)\{\}|\\([#$%&_{}~^])/g,
    (_match, glyph: string | undefined, escaped: string | undefined) => glyph ? glyphs[glyph] : escaped!);
}

/** Split plain runs around emphasis; commands and braces never enter a slot. */
function proseRanges(code: string, start: number, end: number): Array<{ start: number; end: number; original: string }> {
  const ranges: Array<{ start: number; end: number; original: string }> = [];
  let runStart = start;
  const addRange = (from: number, to: number) => {
    while (from < to && /\s/u.test(code[from])) from++;
    while (to > from && /\s/u.test(code[to - 1])) to--;
    if (from < to) ranges.push({ start: from, end: to, original: decodeProse(code.slice(from, to)) });
  };
  for (let cursor = start; cursor < end; cursor++) {
    if (code[cursor] === '\\') {
      const command = commandAt(code, cursor);
      if (command.name === 'textbf') {
        addRange(runStart, cursor);
        const group = readGroup(code, command.after);
        if (group.after > end) throw new Error('Unsupported template structure: emphasis crosses a bullet boundary.');
        ranges.push(...proseRanges(code, group.start, group.end));
        cursor = group.after - 1;
        runStart = group.after;
      } else if (command.name.length === 1 && '#%&_${}^~'.includes(command.name)) {
        cursor = command.after - 1;
      } else if (['textbackslash', 'textasciitilde', 'textasciicircum'].includes(command.name) && code.slice(command.after, command.after + 2) === '{}') {
        cursor = command.after + 1;
      } else {
        throw new Error(`Unsupported template prose command: \\${command.name}. Only plain text and bold emphasis are supported.`);
      }
    } else if ('{}#$&_^~'.includes(code[cursor])) {
      throw new Error('Unsupported template prose: escape TeX special characters.');
    }
  }
  addRange(runStart, end);
  return ranges;
}

function plainBullet(code: string, start: number, end: number): string {
  return proseRanges(code, start, end).map(range => range.original).join(' ');
}

function headerGroup(section: string, header: string, profile: Profile): { group: string; label: string } {
  if (section === 'Experience') {
    const match = /^(?:\\href\{[^{}\r\n]+\}\{\\textbf\{([^{}]+)\}\}|\\textbf\{([^{}]+)\})[ \t]+\\hfill[ \t]+[^{}\\\r\n]+$/u.exec(header);
    if (!match) throw new Error('Unsupported template structure: experience headings must use the existing role, company and date layout.');
    const label = decodeProse(match[1] ?? match[2]);
    const role = profile.experience.find(entry => label.toLowerCase() === `${entry.role}, ${entry.company}`.toLowerCase());
    return { label, group: role ? `experience.${role.id}` : `experience.imported-${digest(label).slice(0, 12)}` };
  }
  const match = /^\\textbf\{(?:\\href\{[^{}\r\n]+\}\{([^{}]+)\}|([^{}]+))\}$/u.exec(header);
  if (!match) throw new Error('Unsupported template structure: project headings must use the existing bold title layout.');
  const label = decodeProse(match[1] ?? match[2]);
  const project = profile.projects.find(entry => label === entry.name || label.startsWith(`${entry.name} —`) || label.startsWith(`${entry.name} --`) || label.startsWith(`${entry.name} |`));
  return { label, group: project ? `project.${project.id}` : `project.imported-${digest(label).slice(0, 12)}` };
}

function extractSlots(source: string, profile: Profile): TextSlot[] {
  const { code, bodyStart, bodyEnd } = validateSource(source);
  const sectionMatches = [...code.slice(bodyStart, bodyEnd).matchAll(/\\section\{([^{}]+)\}/g)];
  if (sectionMatches.map(match => match[1]).join('|') !== SECTIONS.join('|')) {
    throw new Error('Unsupported template structure: Education, Experience, Projects, Technologies and Certifications must occur once in that order.');
  }
  const slots: TextSlot[] = [];
  const addSlot = (range: { start: number; end: number; original: string }, id: string, section: string, group: string, label: string, context: string) => {
    slots.push({ ...range, id, section, group, label, context,
      maxChars: range.original.length + Math.max(8, Math.ceil(range.original.length * 0.15)),
    });
  };
  for (let sectionIndex = 0; sectionIndex < sectionMatches.length; sectionIndex++) {
    const match = sectionMatches[sectionIndex];
    const section = match[1];
    const start = bodyStart + match.index! + match[0].length;
    const end = sectionIndex + 1 < sectionMatches.length ? bodyStart + sectionMatches[sectionIndex + 1].index! : bodyEnd;
    if (section === 'Experience' || section === 'Projects') {
      const sectionCode = code.slice(start, end);
      const blocks = [...sectionCode.matchAll(/\\begin\{resumeitemize\}([\s\S]*?)\\end\{resumeitemize\}/g)];
      if (blocks.length === 0) throw new Error(`Unsupported template structure: ${section} requires resumeitemize entries.`);
      let previousEnd = start;
      const seenGroups = new Set<string>();
      for (const block of blocks) {
        const blockStart = start + block.index!;
        const heading = headerGroup(section, code.slice(previousEnd, blockStart).trim(), profile);
        if (seenGroups.has(heading.group)) throw new Error('Unsupported template structure: duplicate role or project headings.');
        seenGroups.add(heading.group);
        const contentStart = blockStart + '\\begin{resumeitemize}'.length;
        const content = block[1];
        const items = [...content.matchAll(/^[ \t]*\\item[ \t]+([^\r\n]*)/gm)];
        if (items.length === 0 || content.replace(/^[ \t]*\\item[ \t]+[^\r\n]*/gm, '').trim()) {
          throw new Error('Unsupported template structure: use one complete bullet per source line.');
        }
        items.forEach((item, index) => {
          const itemStart = contentStart + item.index! + item[0].length - item[1].length;
          const itemEnd = itemStart + item[1].length;
          const context = `${heading.label}: ${plainBullet(code, itemStart, itemEnd)}`;
          proseRanges(code, itemStart, itemEnd).forEach((range, spanIndex) => {
            addSlot(range, `${heading.group}.bullet.${index}.span.${spanIndex}`, section, heading.group,
              `${heading.label} · bullet ${index + 1}, text ${spanIndex + 1}`, context);
          });
        });
        previousEnd = blockStart + block[0].length;
      }
      if (code.slice(previousEnd, end).trim()) throw new Error(`Unsupported template structure after the final ${section} entry.`);
    }
    if (section === 'Technologies') {
      const categoryLines = [...code.slice(start, end).matchAll(/^[ \t]*\\textbf\{([^{}]+):\}[ \t]+([^\r\n]*)/gm)];
      if (categoryLines.length !== TECHNOLOGY_LABELS.length || code.slice(start, end).replace(/^[ \t]*\\textbf\{([^{}]+):\}[ \t]+[^\r\n]*/gm, '').trim()) {
        throw new Error('Unsupported template structure: preserve the four technology category rows.');
      }
      categoryLines.forEach((line, categoryIndex) => {
        const categoryLabel = TECHNOLOGY_LABELS[categoryIndex];
        if (decodeProse(line[1]) !== categoryLabel) throw new Error('Unsupported template structure: technology category labels or order changed.');
        const category = profile.skills.find(entry => entry.name === categoryLabel);
        if (!category) throw new Error(`The saved profile is missing the technology category "${categoryLabel}". Restore that category before importing the resume.`);
        const valueStart = start + line.index! + line[0].length - line[2].length;
        // A genuine TeX line break ends the content; escaped glyphs remain inside it.
        let valueEnd = valueStart + line[2].length;
        for (let cursor = valueStart; cursor < valueEnd; cursor++) {
          if (code[cursor] !== '\\') continue;
          const command = commandAt(code, cursor);
          if (command.name === '\\') { valueEnd = cursor; break; }
          cursor = command.after - 1;
        }
        const ranges = proseRanges(code, valueStart, valueEnd);
        if (ranges.length !== 1) throw new Error('Unsupported template structure: technology values must be plain text.');
        addSlot(ranges[0], `skills.${category.id}`, section, `skills.${category.id}`, category.name, `${category.name}: ${ranges[0].original}`);
      });
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

export function extractTemplate(source: string, name: string, profile?: Profile): ResumeTemplate {
  const profileBinding = profile ? structuredClone(profile) : undefined;
  const slots = extractSlots(source, profileBinding ?? seedProfile);
  const sourceHash = digest(source);
  return {
    id: `template-${sourceHash.slice(0, 20)}`, name: name.trim() || 'Imported resume', source, sourceHash, slots,
    importedAt: new Date().toISOString(), baselinePages: null,
    ...(profileBinding ? { profileBinding } : {}),
  };
}

/** Render only validated text spans; untouched content is copied from the source. */
export function renderTemplate(template: ResumeTemplate, edits: Edit[]): string {
  if (digest(template.source) !== template.sourceHash) throw new Error('Template source hash mismatch: the imported source was modified.');
  const canonicalSlots = extractSlots(template.source, template.profileBinding ?? seedProfile);
  if (JSON.stringify(template.slots) !== JSON.stringify(canonicalSlots)) throw new Error('Template slot integrity check failed: slot definitions were modified.');
  const slots = new Map(canonicalSlots.map(slot => [slot.id, slot]));
  const seen = new Set<string>();
  const changes: Array<{ slot: TextSlot; text: string }> = [];
  for (const edit of edits) {
    const slot = slots.get(edit.slotId);
    if (!slot) throw new Error(`Unknown template slot: ${edit.slotId}`);
    if (seen.has(edit.slotId)) throw new Error(`Duplicate edit for template slot: ${edit.slotId}`);
    seen.add(edit.slotId);
    if (typeof edit.text !== 'string' || !edit.text.trim()) throw new Error(`An edit for ${edit.slotId} must contain plain text.`);
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(edit.text)) throw new Error('Edits cannot contain line breaks or control characters.');
    if (edit.text.length > slot.maxChars) throw new Error(`Edit length exceeds the ${slot.maxChars} character limit for ${slot.label}.`);
    // A no-op preserves even original escape spelling, not just equivalent output.
    if (edit.text !== slot.original) changes.push({ slot, text: edit.text.replace(/[\\{}$&#%_^~]/g, character => specialCharacters[character]) });
  }
  let rendered = template.source;
  for (const change of changes.sort((a, b) => b.slot.start - a.slot.start)) {
    rendered = rendered.slice(0, change.slot.start) + change.text + rendered.slice(change.slot.end);
  }
  return rendered;
}
