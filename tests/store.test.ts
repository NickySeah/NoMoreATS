import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
describe('personal workspace persistence', () => {
  it('restores saved career evidence after a server restart and redacts the key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nomoreats-store-')); dirs.push(dir);
    const first = await Store.open(dir);
    const profile = first.state().profile;
    await first.saveProfile({ ...profile, additionalEvidence: 'Built a search feature backed by PostgreSQL.' });
    await first.saveSettings({ apiKey: 'sk-test-local-only', model: 'test/model' });
    const restarted = await Store.open(dir);
    expect(restarted.state().profile.additionalEvidence).toBe('Built a search feature backed by PostgreSQL.');
    expect(restarted.key()).toBe('sk-test-local-only');
    expect(JSON.stringify(restarted.state())).not.toContain('sk-test-local-only');
    expect(restarted.state().settings.apiKeyConfigured).toBe(true);
  });
  it('serializes concurrent updates without losing profile or settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nomoreats-store-')); dirs.push(dir);
    const store = await Store.open(dir);
    await Promise.all([store.saveProfile({ ...store.state().profile, summary: 'Engineer' }), store.saveSettings({ model: 'test/model' })]);
    const restarted = await Store.open(dir);
    expect(restarted.state().profile.summary).toBe('Engineer');
    expect(restarted.state().settings.model).toBe('test/model');
  });
});
