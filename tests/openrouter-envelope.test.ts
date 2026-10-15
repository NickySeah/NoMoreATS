import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { analyzeEvidenceWithOpenRouter, requestStructuredOutput } from '../server/ai';

const job = { company: 'Fixture', role: 'Engineer', description: 'Build services.', url: '', instructions: '' };
const callers = [
  { name: 'evidence analysis', call: (fetcher: typeof fetch) => analyzeEvidenceWithOpenRouter({ key: 'private-fixture-key', model: 'fixture/model', privacyMode: true, job, evidence: [], groups: [], fetcher }) },
  { name: 'shared structured output', call: (fetcher: typeof fetch) => requestStructuredOutput({ key: 'private-fixture-key', model: 'fixture/model', privacyMode: true, schema: z.object({ summary: z.string() }), schemaName: 'fixture', messages: [], fetcher }) },
];

describe.each(callers)('OpenRouter envelope: $name', ({ call }) => {
  it.each([
    { body: '', type: 'application/json', state: 'empty' },
    { body: ' \r\n\t', type: 'application/json', state: 'whitespace-only' },
    { body: '<html>Private profile and provider detail</html>', type: 'text/html; charset=utf-8', state: 'malformed JSON' },
    { body: '{"choices": ["Private profile detail"', type: 'application/json', state: 'malformed JSON' },
  ])('diagnoses $state successful HTTP bodies ($type) without leaking or retrying', async ({ body, type, state }) => {
    const fetcher = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': type, 'x-request-id': 'gen-fixture_123' } }));
    const error = await call(fetcher).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error('Expected provider failure, not success.');
    expect(error.message).toContain('OpenRouter returned an unreadable response envelope');
    expect(error.message).toContain(`HTTP 200; content type: ${type.split(';')[0]}; body: ${state}`);
    expect(error.message).toContain('provider/server response error, not a model-generated JSON error');
    expect(error.message).toContain('Your saved data is intact. Retry explicitly or choose another model.');
    expect(error.message).toContain('Request ID: gen-fixture_123.');
    expect(error.message).not.toMatch(/Private|private-fixture-key|choices|<html>/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not expose arbitrary content types, request IDs or body-read errors', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('Private read failure')); } }), {
      headers: { 'content-type': 'private/profile-detail', 'x-request-id': 'Private-profile-detail' },
    });
    const fetcher = vi.fn(async () => response);
    const error = await call(fetcher).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected provider failure, not success.');
    expect(error.message).toContain('content type: unrecognized; body: unreadable');
    expect(error.message).not.toMatch(/Private|private|Request ID/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports missing content type and omits unsafe request IDs', async () => {
    const fetcher = vi.fn(async () => new Response(null, { headers: { 'x-request-id': 'gen-private@profile.example' } }));
    const error = await call(fetcher).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected provider failure, not success.');
    expect(error.message).toContain('content type: missing; body: empty');
    expect(error.message).not.toMatch(/Request ID|private@/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps model-generated invalid JSON distinct from a broken envelope', async () => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: 'Private invalid model content' }, finish_reason: 'stop' }] }));
    const error = await call(fetcher).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected model failure, not success.');
    expect(error.message).toContain('The model did not return valid JSON');
    expect(error.message).not.toMatch(/envelope|Private/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('accepts a valid envelope even without a JSON content type', async () => {
    const content = { summary: 'Fixture summary', questions: [] };
    const result = await call(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] })));
    expect('data' in result ? result.data : result).toEqual(content);
  });
  it('preserves HTTP-status errors instead of parsing failed HTTP bodies', async () => {
    const fetcher = vi.fn(async () => new Response('Private upstream detail', { status: 402 }));
    await expect(call(fetcher)).rejects.toThrow('OpenRouter has insufficient credits.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
