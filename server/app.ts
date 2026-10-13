import express, { type Request, type Response, type NextFunction } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { Analysis, EvidenceQuestion, EvidenceSaveResult, Job, JobInput, PdfResult, Resume, ResumeTemplate } from '../shared/types';
import { getEvidence, getEvidenceGroups } from '../shared/evidence';
import { Store } from './store';
import { jobInputSchema, profileSchema, settingsSchema } from './validation';
import { extractTemplate, renderTemplate } from './template';
import { analyzeEvidenceWithOpenRouter, validateQuestionAnalysis, isResumeReusable, listModels, tailorWithOpenRouter, validateAnalysis } from './ai';
import { artifactPath, compilePdf, isOnePagePdf } from './pdf';
import { assertTemplateFacts } from './consistency';

type Analyze = typeof analyzeEvidenceWithOpenRouter;
type Generate = typeof tailorWithOpenRouter;
type Compile = typeof compilePdf;
export function createApp(store: Store, options: { analyze?: Analyze; generate?: Generate; compile?: Compile } = {}) {
  const app = express();
  const privateOrigin = process.env.TAILSCALE_ORIGIN?.trim();
  const privateUser = process.env.TAILSCALE_USER?.trim();
  if (Boolean(privateOrigin) !== Boolean(privateUser)) throw new Error('Set both TAILSCALE_ORIGIN and TAILSCALE_USER.');
  const privateUrl = privateOrigin ? new URL(privateOrigin) : null;
  if (privateUrl && (privateUrl.protocol !== 'https:' || privateUrl.origin !== privateOrigin || !privateUrl.hostname.endsWith('.ts.net'))) throw new Error('TAILSCALE_ORIGIN must be an exact HTTPS ts.net origin.');
  const generate = options.generate || tailorWithOpenRouter;
  const compile = options.compile || compilePdf;
  const compiling = new Map<string, Promise<Resume>>();
  let generating = false;
  const reviews = new Map<string, { job: JobInput; binding: string; questions: EvidenceQuestion[]; reviewed: boolean; expires: number; answerHash?: string; save?: Promise<EvidenceSaveResult> }>();
  const binding = (state: ReturnType<Store['state']>) => createHash('sha256').update(JSON.stringify({ profile: { ...state.profile, updatedAt: '' }, template: { id: state.template.id, sourceHash: state.template.sourceHash } })).digest('hex');
  const findReview = (id: string, job: JobInput) => {
    const review = reviews.get(id);
    if (!review || review.expires < Date.now() || JSON.stringify(review.job) !== JSON.stringify(job) || review.binding !== binding(store.state())) throw new HttpError(409, 'This evidence review is out of date. Return to job details and analyze again.');
    return review;
  };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host?.split(':')[0];
    const localHost = Boolean(host && ['localhost', '127.0.0.1'].includes(host));
    const serveHost = Boolean(privateUrl && req.headers.host === privateUrl.host);
    if (!localHost && !serveHost) return res.status(403).json({ error: 'This personal workspace accepts localhost or its configured private hostname only.' });
    // Trust Serve identity headers only while the backend is loopback-published;
    // Serve strips client-supplied identity headers before injecting its own.
    if ((serveHost || req.headers['tailscale-user-login']) && (!privateUser || req.headers['tailscale-user-login'] !== privateUser)) return res.status(403).json({ error: 'This workspace is restricted to its configured Tailscale user.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = ['http://localhost:5173', 'http://127.0.0.1:5173', `http://localhost:${process.env.PORT || '3001'}`, `http://127.0.0.1:${process.env.PORT || '3001'}`];
      if (privateOrigin) allowed.push(privateOrigin);
      if (origin && !allowed.includes(origin)) return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Send changes as application/json.' });
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  const findResume = (id: string) => {
    const resume = store.state().resumes.find(item => item.id === id);
    if (!resume) throw new HttpError(404, 'Resume not found.');
    return resume;
  };
  const requireOnePage = (pdf: PdfResult) => {
    if (!isOnePagePdf(pdf)) throw new HttpError(422, `A resume must be verified as exactly one page before it can be saved or used. ${pdf.message}`);
  };
  async function compileResume(id: string): Promise<Resume> {
    if (compiling.has(id)) return compiling.get(id)!;
    const original = findResume(id);
    const operation = (async () => {
      const pdf = await compile(store.dir, original.id, original.latex);
      return store.update(state => {
        const resume = state.resumes.find(item => item.id === id)!;
        resume.pdf = pdf;
        return resume;
      });
    })().finally(() => compiling.delete(id));
    compiling.set(id, operation);
    return operation;
  }
  app.get('/api/state', (_req, res) => res.json(store.state()));
  app.put('/api/profile', async (req, res) => res.json(await store.saveProfile(profileSchema.parse(req.body))));
  app.put('/api/settings', async (req, res) => res.json(await store.saveSettings(settingsSchema.parse(req.body))));
  app.get('/api/models', async (_req, res) => res.json({ models: await listModels(store.key()) }));
  app.get('/api/export', (_req, res) => { res.attachment('nomoreats-backup.json').json({ version: 1, ...store.state() }); });
  app.post('/api/evidence/analyze', async (req, res) => {
    const { job } = z.object({ job: jobInputSchema }).strict().parse(req.body);
    if (!store.key() || !store.settings().model) throw new HttpError(400, 'Connect your OpenRouter API key and choose a model in Settings first.');
    const snapshot = store.state();
    const groups = getEvidenceGroups(snapshot.profile);
    const result = validateQuestionAnalysis(await (options.analyze || analyzeEvidenceWithOpenRouter)({ key: store.key(), model: snapshot.settings.model, privacyMode: snapshot.settings.privacyMode, evidence: getEvidence(snapshot.profile), groups, job }), getEvidence(snapshot.profile), groups, job.description);
    const reviewId = randomUUID();
    for (const [id, review] of reviews) if (review.expires < Date.now()) reviews.delete(id);
    if (reviews.size >= 50) reviews.delete(reviews.keys().next().value!);
    reviews.set(reviewId, { job, binding: binding(snapshot), questions: result.questions, reviewed: false, expires: Date.now() + 30 * 60 * 1000 });
    res.json({ ...result, groups, reviewId });
  });
  app.post('/api/evidence/save', async (req, res) => {
    const input = z.object({ reviewId: z.string().uuid(), job: jobInputSchema, answers: z.array(z.object({ questionId: z.string().max(80), disposition: z.enum(['answer', 'no-experience', 'skip']), text: z.string().trim().max(3000).refine(text => !/[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text), 'Use factual plain text, not LaTeX.'), group: z.string().max(100).nullable() }).strict()).max(8) }).strict().parse(req.body);
    const review = findReview(input.reviewId, input.job);
    const answerHash = createHash('sha256').update(JSON.stringify(input.answers)).digest('hex');
    if (review.save) {
      if (review.answerHash !== answerHash) throw new HttpError(409, 'These answers were already saved. Continue to generation or analyze again.');
      return res.json(await review.save);
    }
    const ids = input.answers.map(answer => answer.questionId);
    if (new Set(ids).size !== ids.length || ids.length !== review.questions.length || review.questions.some(question => !ids.includes(question.id))) throw new HttpError(400, 'Review each question exactly once.');
    review.answerHash = answerHash;
    const save = (async () => {
      let savedCount = 0;
      const profile = await store.update(state => {
        if (binding({ ...state, settings: store.settings() }) !== review.binding) throw new HttpError(409, 'Your profile changed. Analyze again before saving answers.');
        for (const answer of input.answers) {
          if (answer.disposition !== 'answer') {
            if (answer.text || answer.group) throw new HttpError(400, 'No experience and skipped answers cannot save positive evidence.');
            continue;
          }
          if (!answer.text || !answer.group) throw new HttpError(400, 'Enter a factual answer and select its existing role, project or skill category.');
          const entry = state.profile.experience.find(item => `experience.${item.id}` === answer.group) || state.profile.projects.find(item => `project.${item.id}` === answer.group) || state.profile.skills.find(item => `skills.${item.id}` === answer.group);
          if (!entry) throw new HttpError(400, 'Choose an existing role, project or skill category.');
          entry.notes = [entry.notes, answer.text].filter(Boolean).join('\n\n');
          savedCount++;
        }
        state.profile = profileSchema.parse({ ...state.profile, updatedAt: new Date().toISOString() });
        return state.profile;
      });
      review.binding = binding(store.state());
      review.reviewed = true;
      return { reviewId: input.reviewId, profile, savedCount };
    })();
    review.save = save;
    try { res.json(await save); } catch (error) { delete review.save; delete review.answerHash; throw error; }
  });
  app.post('/api/template', async (req, res) => {
    const input = z.object({ path: z.string().min(1).max(1000).optional(), source: z.string().min(1).max(200000).optional(), name: z.string().max(200).optional() }).parse(req.body);
    if (Boolean(input.path) === Boolean(input.source)) throw new HttpError(400, 'Provide either a local .tex path or uploaded source.');
    if (input.path && extname(input.path).toLowerCase() !== '.tex') throw new HttpError(400, 'Select a .tex file.');
    let source: string;
    try { source = input.source || await readFile(resolve(input.path!), 'utf8'); }
    catch { throw new HttpError(400, 'The local template file could not be read. Check its path or upload the .tex file.'); }
    const template = extractTemplate(source, input.name || (input.path ? basename(input.path) : 'Imported resume.tex'), store.state().profile);
    assertTemplateFacts(template, store.state().profile);
    const previewId = `preview-${randomUUID()}`;
    const pdf = await compile(store.dir, previewId, source);
    requireOnePage(pdf);
    template.baselinePages = pdf.pages;
    await store.update(state => { state.template = template; if (input.path) state.settings.templatePath = input.path; });
    res.json(template);
  });
  app.post('/api/jobs', async (req, res) => {
    const input = z.object({ job: jobInputSchema, resumeId: z.string(), analysis: z.unknown().optional() }).parse(req.body);
    let resume = findResume(input.resumeId);
    if (!isOnePagePdf(resume.pdf)) resume = await compileResume(resume.id);
    requireOnePage(resume.pdf);
    const snapshot = store.state();
    const evidence = getEvidence(snapshot.profile);
    const analysis = input.analysis === undefined ? null : validateAnalysis(input.analysis, snapshot.template, evidence, [resume], input.job.description);
    const job: Job = { ...input.job, id: randomUUID(), resumeId: input.resumeId, status: 'Draft', createdAt: new Date().toISOString(), analysis, ...(analysis ? { evidenceSnapshot: evidence } : {}) };
    await store.update(state => { state.jobs.unshift(job); });
    res.status(201).json(job);
  });
  app.patch('/api/jobs/:id', async (req, res) => {
    const input = z.object({ status: z.enum(['Draft', 'Applied', 'Interviewing', 'Offer', 'Closed']) }).parse(req.body);
    const job = await store.update(state => {
      const job = state.jobs.find(job => job.id === req.params.id);
      if (!job) throw new HttpError(404, 'Application not found.');
      job.status = input.status;
      return job;
    });
    res.json(job);
  });
  app.post('/api/tailor', async (req, res) => {
    const input = z.object({ job: jobInputSchema, forceNew: z.boolean().optional(), reviewId: z.string().uuid().optional() }).strict().parse(req.body);
    if (input.reviewId && !findReview(input.reviewId, input.job).reviewed) throw new HttpError(409, 'Review and save your answers before generating.');
    if (generating) throw new HttpError(409, 'A resume is already being tailored. Wait for it to finish.');
    if (!store.key() || !store.settings().model) throw new HttpError(400, 'Connect your OpenRouter API key and choose a model in Settings first.');
    const snapshot = store.state();
    assertTemplateFacts(snapshot.template, snapshot.profile);
    const evidence = getEvidence(snapshot.profile);
    for (const slot of snapshot.template.slots) {
      if (!evidence.some(fact => fact.group === slot.group)) throw new HttpError(400, `The template entry “${slot.context.split(':')[0]}” has no matching profile evidence. Keep the original entry IDs, or reimport a supported template.`);
    }
    generating = true;
    try {
      const candidates = snapshot.resumes.filter(resume => isResumeReusable(resume, snapshot.template, evidence)).slice(0, 12);
      const generation = { key: store.key(), model: snapshot.settings.model, privacyMode: snapshot.settings.privacyMode, template: snapshot.template, evidence, candidates, job: input.job, forceNew: Boolean(input.forceNew) };
      let analysis = await generate(generation);
      const job: Job = { ...input.job, id: randomUUID(), resumeId: null, status: 'Draft', createdAt: new Date().toISOString(), analysis, evidenceSnapshot: evidence };
      if (analysis.reuseSuggestion) {
        let suggestedResume = candidates.find(resume => resume.id === analysis.reuseSuggestion!.resumeId)!;
        if (!isOnePagePdf(suggestedResume.pdf)) suggestedResume = await compileResume(suggestedResume.id);
        requireOnePage(suggestedResume.pdf);
        // The user confirms reuse through POST /api/jobs; no duplicate draft is saved here.
        return res.json({ resume: null, job, analysis, suggestedResume });
      }
      const id = randomUUID();
      let persisted = false;
      try {
        let latex = renderTemplate(snapshot.template, analysis.edits);
        let pdf = await compile(store.dir, id, latex);
        if (pdf.status === 'overflow' || (pdf.pages !== null && pdf.pages > 1) || pdf.warnings.some(warning => warning.startsWith('Overfull'))) {
          analysis = await generate({ ...generation, candidates: [], forceNew: true, fitToOnePage: true });
          if (analysis.reuseSuggestion) throw new HttpError(422, 'A shorter one-page version must be generated before this resume can be saved.');
          latex = renderTemplate(snapshot.template, analysis.edits);
          pdf = await compile(store.dir, id, latex);
        }
        requireOnePage(pdf);
        job.analysis = analysis;
        const resume: Resume = { id, name: `${input.job.company} · ${input.job.role}`, kind: 'tailored', createdAt: job.createdAt, templateId: snapshot.template.id, templateHash: snapshot.template.sourceHash, templateSnapshot: snapshot.template, profileSnapshot: snapshot.profile, latex, analysis, pdf, model: snapshot.settings.model };
        job.resumeId = resume.id;
        await store.update(state => { state.resumes.unshift(resume); state.jobs.unshift(job); });
        persisted = true;
        res.status(201).json({ resume, job, analysis, suggestedResume: null });
      } finally {
        const root = resolve(store.dir, 'artifacts');
        const draft = resolve(root, id);
        if (!persisted && dirname(draft) === root) await rm(draft, { recursive: true, force: true });
      }
    } finally { generating = false; }
  });
  app.get('/api/resumes/:id/tex', (req, res) => { const resume = findResume(req.params.id); res.attachment(`${safeFilename(resume.name)}.tex`).type('text/plain').send(resume.latex); });
  app.post('/api/resumes/:id/compile', async (req, res) => res.json(await compileResume(req.params.id)));
  app.get('/api/resumes/:id/pdf', async (req, res) => {
    let resume = findResume(req.params.id);
    const artifactExists = await access(artifactPath(store.dir, resume.id)).then(() => true, () => false);
    if (!isOnePagePdf(resume.pdf) || !artifactExists) resume = await compileResume(resume.id);
    requireOnePage(resume.pdf);
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${safeFilename(resume.name)}.pdf"`);
    // Data directories may live under a hidden user/config or temporary directory.
    res.sendFile(resolve(artifactPath(store.dir, resume.id)), { dotfiles: 'allow' });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res, next) => res.sendFile(resolve('dist/index.html'), error => error ? next() : undefined));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if ((error as any)?.type === 'entity.too.large') return res.status(413).json({ error: 'This input is too large.' });
    res.status(400).json({ error: error instanceof Error ? error.message : 'The request failed.' });
  });
  return app;
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function safeFilename(name: string) { return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 100) || 'resume'; }
