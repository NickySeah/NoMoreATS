import { expect, it } from 'vitest';
import { inspectPdfLog } from '../server/pdf';

it('detects overflow even after the displayed warning limit', () => {
  const log = [...Array(25).fill('Underfull \\hbox (badness 10000)'), 'Overfull \\hbox (2pt too wide)', 'Output written on resume.pdf (1 page, 123 bytes).'].join('\n');
  const result = inspectPdfLog(log);
  expect(result.pages).toBe(1);
  expect(result.overflow).toBe(true);
  expect(result.warnings.length).toBeLessThanOrEqual(20);
  expect(result.warnings.some(warning => warning.startsWith('Overfull'))).toBe(true);
});
