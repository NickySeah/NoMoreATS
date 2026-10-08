import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PdfResult } from '../shared/types';

export const artifactPath = (dataDir: string, id: string) => join(dataDir, 'artifacts', id, 'resume.pdf');
export const isOnePagePdf = (pdf: PdfResult) => pdf.status === 'ready' && pdf.pages === 1 && !pdf.warnings.some(warning => warning.startsWith('Overfull'));

export function inspectPdfLog(log: string) {
  const pages = Number(log.match(/Output written on .+?\((\d+) pages?/)?.[1]) || null;
  const allWarnings = [...log.matchAll(/(?:Overfull|Underfull) \\[^\n]+/g)].map(match => match[0]);
  const overfull = allWarnings.filter(warning => warning.startsWith('Overfull'));
  const warnings = [...overfull, ...allWarnings.filter(warning => !warning.startsWith('Overfull'))].slice(0, 20);
  return { pages, warnings, overflow: (pages !== null && pages > 1) || overfull.length > 0 };
}

export async function compilePdf(dataDir: string, id: string, latex: string): Promise<PdfResult> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid artifact identifier.');
  const directory = join(dataDir, 'artifacts', id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'resume.tex'), latex, 'utf8');
  try {
    await run('pdflatex', ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], directory, 45000);
    const log = await readFile(join(directory, 'resume.log'), 'utf8');
    const { pages, warnings, overflow } = inspectPdfLog(log);
    if (pages === null) return { status: 'failed', pages, message: 'PDF was produced, but page count could not be verified.', warnings };
    if (overflow) return { status: 'overflow', pages, message: 'Text exceeds the original one-page layout. The LaTeX format is unchanged; shorten the content and generate again.', warnings };
    try {
      const text = await run('pdftotext', ['resume.pdf', '-'], directory, 10000);
      if (text.trim().length < 100) return { status: 'failed', pages, message: 'The PDF did not contain enough extractable text to verify it.', warnings };
    } catch { warnings.push('PDF text extraction could not be checked because pdftotext is unavailable.'); }
    return { status: 'ready', pages, message: 'Compiled with the original layout. Review the PDF before submitting.', warnings };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { status: missing ? 'unavailable' : 'failed', pages: null, message: missing ? 'Install MiKTeX or TeX Live and put pdflatex on PATH. LaTeX download is available.' : `LaTeX compilation failed: ${(error as Error).message.slice(0, 500)}. LaTeX download is available.`, warnings: [] };
  }
}

function run(command: string, args: string[], cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, openin_any: 'p', openout_any: 'p' } });
    let output = '';
    let errorText = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Compiler timed out')); }, timeout);
    child.stdout.on('data', chunk => { if (output.length < 1000000) output += chunk; });
    child.stderr.on('data', chunk => { if (errorText.length < 10000) errorText += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(errorText.trim().slice(-300) || output.split('\n').filter(line => line.startsWith('!')).slice(0, 3).join(' ') || `Compiler exited with code ${code}`));
    });
  });
}
