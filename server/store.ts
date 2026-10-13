import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState, Profile, Resume, Settings } from '../shared/types';
import { extractTemplate } from './template';
import { seedProfile } from './seed';

interface DiskState extends Omit<AppState, 'settings'> { version: 1; settings: { model: string; templatePath: string; privacyMode: boolean } }

export class FollowupProfileConflictError extends Error {
  constructor() {
    super('Your profile changed after follow-up answers were saved in another window. Reload before saving so those answers are preserved.');
    this.name = 'FollowupProfileConflictError';
  }
}

export class Store {
  private pending: Promise<unknown> = Promise.resolve();
  private localKey = '';
  private constructor(public readonly dir: string, private data: DiskState) {}
  static async open(dir: string): Promise<Store> {
    await mkdir(dir, { recursive: true });
    let data: DiskState;
    try {
      data = JSON.parse(await readFile(join(dir, 'workspace.json'), 'utf8'));
      if (data.version !== 1 || !data.profile || !data.template || !Array.isArray(data.resumes) || !Array.isArray(data.jobs)) throw new Error('Workspace file is invalid. Restore a backup; the existing file has been preserved.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const source = await readFile(new URL('../templates/nicholas.tex', import.meta.url), 'utf8');
      const template = extractTemplate(source, 'main.tex', seedProfile);
      const profile = structuredClone(seedProfile);
      const original: Resume = { id: randomUUID(), name: 'Original resume', createdAt: new Date().toISOString(), kind: 'original', templateId: template.id, templateHash: template.sourceHash, templateSnapshot: template, profileSnapshot: profile, latex: source, analysis: null, pdf: { status: 'unavailable', pages: null, message: 'Compile your original resume to preview the PDF.', warnings: [] }, model: null };
      data = { version: 1, profile, template, resumes: [original], jobs: [], settings: { model: '', templatePath: 'C:\\Users\\nicho\\codingRelated\\NicholasResume\\main.tex', privacyMode: true } };
      await atomicWrite(join(dir, 'workspace.json'), data);
    }
    const store = new Store(dir, data);
    try { store.localKey = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8')).openrouterKey ?? ''; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return store;
  }
  state(): AppState {
    const { version: _version, ...data } = structuredClone(this.data);
    return { ...data, settings: this.settings() };
  }
  settings(): Settings {
    const env = Boolean(process.env.OPENROUTER_API_KEY?.trim());
    return { ...this.data.settings, apiKeyConfigured: Boolean(this.key()), keySource: env ? 'environment' : this.localKey ? 'local' : 'none' };
  }
  key(): string { return process.env.OPENROUTER_API_KEY?.trim() || this.localKey; }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }
  async update<T>(change: (state: DiskState) => T): Promise<T> {
    return this.enqueue(async () => {
      const copy = structuredClone(this.data);
      const value = change(copy);
      await atomicWrite(join(this.dir, 'workspace.json'), copy);
      this.data = copy;
      return structuredClone(value);
    });
  }
  async saveProfile(profile: Profile): Promise<Profile> {
    return this.update(state => {
      if (profile.updatedAt !== state.profile.updatedAt) {
        const incomingAt = Date.parse(profile.updatedAt);
        const answersSavedSince = state.followups?.some(round => round.answeredAt && round.answers.length > 0 && (!Number.isFinite(incomingAt) || Date.parse(round.answeredAt) > incomingAt));
        if (answersSavedSince) throw new FollowupProfileConflictError();
      }
      state.profile = { ...profile, updatedAt: new Date().toISOString() };
      return state.profile;
    });
  }
  async saveSettings(settings: { model?: string; apiKey?: string; clearApiKey?: boolean; privacyMode?: boolean }): Promise<Settings> {
    await this.enqueue(async () => {
      const copy = structuredClone(this.data);
      if (settings.model !== undefined) copy.settings.model = settings.model.trim();
      if (settings.privacyMode !== undefined) copy.settings.privacyMode = settings.privacyMode;
      const nextKey = settings.clearApiKey ? '' : settings.apiKey?.trim() || this.localKey;
      if (settings.apiKey !== undefined || settings.clearApiKey) await atomicWrite(join(this.dir, 'secrets.json'), { openrouterKey: nextKey });
      await atomicWrite(join(this.dir, 'workspace.json'), copy);
      this.data = copy;
      this.localKey = nextKey;
    });
    return this.settings();
  }
}

async function atomicWrite(path: string, data: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}
