import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store';
import { appendFollowupAnswers } from '../server/followups';
import type { FollowupRound } from '../shared/types';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const beforeAnswers = '2026-10-08T00:00:00.000Z';
const answeredAt = '2026-10-08T00:01:00.000Z';
const answerText = 'I built contract tests and maintained the CI checks.';
const conflictMessage = 'Your profile changed after follow-up answers were saved in another window. Reload before saving so those answers are preserved.';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nomoreats-followup-concurrency-')); dirs.push(dir);
  const store = await Store.open(dir);
  await store.update(state => { state.profile.updatedAt = beforeAnswers; state.profile.experience[0].notes = ''; });
  return store;
}

async function saveAnswers(store: Store) {
  return store.update(state => {
    const group = `experience.${state.profile.experience[0].id}`;
    const round: FollowupRound = {
      id: 'round-1', job: { company: 'Example', role: 'Engineer', description: 'Build APIs and contract tests.', url: '', instructions: '' },
      jobId: null, resumeId: null, createdAt: beforeAnswers, answeredAt,
      questions: [{ id: 'q-1', question: 'Have you built contract tests?', reason: 'Clarify testing work.', sourceQuote: 'contract tests', targetGroup: group }],
      answers: [{ questionId: 'q-1', text: answerText, group }],
    };
    state.profile = appendFollowupAnswers(state.profile, round, round.answers);
    state.profile.updatedAt = answeredAt;
    state.followups = [round];
    return state.profile;
  });
}

describe('follow-up answers protected from stale profile saves', () => {
  it('rejects another window’s stale contact edit without erasing saved notes or changing persisted state', async () => {
    const store = await fixture();
    const stale = store.state().profile;
    await saveAnswers(store);
    const savedState = store.state();
    stale.contact.location = 'A stale window edit';

    await expect(store.saveProfile(stale)).rejects.toMatchObject({ name: 'FollowupProfileConflictError', message: conflictMessage });
    expect(store.state()).toEqual(savedState);
    expect((await Store.open(store.dir)).state().profile.experience[0].notes).toBe(answerText);
    expect(store.state().profile.contact.location).not.toBe('A stale window edit');
  });

  it.each(['', 'invalid timestamp'])('rejects an invalid old timestamp %j when answers have been saved', async updatedAt => {
    const store = await fixture();
    const stale = store.state().profile;
    await saveAnswers(store);
    stale.updatedAt = updatedAt;

    await expect(store.saveProfile(stale)).rejects.toMatchObject({ name: 'FollowupProfileConflictError' });
    expect(store.state().profile.experience[0].notes).toBe(answerText);
  });

  it('allows a fresh snapshot to intentionally edit or remove notes after the answers were saved', async () => {
    const store = await fixture();
    const fresh = await saveAnswers(store);
    fresh.experience[0].notes = 'The user intentionally replaced these notes.';
    const edited = await store.saveProfile(fresh);
    expect(edited.experience[0].notes).toBe('The user intentionally replaced these notes.');
    edited.experience[0].notes = '';
    expect((await store.saveProfile(edited)).experience[0].notes).toBe('');
  });

  it('keeps ordinary rapid autosaves working when no follow-up answers exist', async () => {
    const store = await fixture();
    const first = store.state().profile;
    const second = structuredClone(first);
    first.contact.location = 'First edit';
    second.contact.location = 'Second edit';
    second.experience[0].notes = 'A later ordinary note edit';
    await Promise.all([store.saveProfile(first), store.saveProfile(second)]);
    expect(store.state().profile.contact.location).toBe('Second edit');
    expect(store.state().profile.experience[0].notes).toBe('A later ordinary note edit');
  });

  it('allows later rapid autosaves based on a snapshot newer than the saved answers', async () => {
    const store = await fixture();
    const fresh = await saveAnswers(store);
    await store.update(state => { state.profile.updatedAt = '2026-10-08T00:02:00.000Z'; });
    const first = store.state().profile;
    const second = structuredClone(first);
    first.contact.location = 'First newer edit';
    second.contact.location = 'Second newer edit';
    await Promise.all([store.saveProfile(first), store.saveProfile(second)]);
    expect(store.state().profile.contact.location).toBe('Second newer edit');
    expect(store.state().profile.experience[0].notes).toBe(fresh.experience[0].notes);
  });

  it('allows an old snapshot when every saved round was skipped or remains unanswered', async () => {
    const store = await fixture();
    const stale = store.state().profile;
    await saveAnswers(store);
    await store.update(state => {
      state.followups = [
        { ...state.followups![0], answers: [] },
        { ...state.followups![0], id: 'pending-round', answeredAt: null },
      ];
    });
    stale.contact.location = 'Ordinary edit';
    expect((await store.saveProfile(stale)).contact.location).toBe('Ordinary edit');
  });
});
