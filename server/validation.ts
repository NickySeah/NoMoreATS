import { z } from 'zod';
const text = z.string().max(20000);
const short = z.string().max(500);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const url = z.string().max(2000).refine(value => !value || /^https?:\/\//i.test(value), 'Use an http or https URL.');
const bullets = z.array(z.string().max(3000)).max(50);
export const profileSchema = z.object({
  contact: z.object({ name: short, email: short, phone: short, location: short, website: url, linkedin: url, github: url }),
  summary: text,
  experience: z.array(z.object({ id, company: short, role: short, dates: short, url, bullets, notes: text })).max(50),
  projects: z.array(z.object({ id, name: short, technologies: short, url, bullets, notes: text })).max(50),
  education: z.array(z.object({ id, school: short, degree: short, dates: short, details: bullets })).max(20),
  skills: z.array(z.object({ id, name: short, items: z.string().max(3000), notes: text.optional() })).max(30),
  certifications: z.array(z.object({ id, name: short, issuer: short, url })).max(50),
  additionalEvidence: text,
  updatedAt: z.string(),
}).superRefine((profile, ctx) => {
  for (const key of ['experience', 'projects', 'education', 'skills', 'certifications'] as const) {
    const ids = profile[key].map(item => item.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [key], message: 'Each entry needs a unique ID.' });
  }
});
export const jobInputSchema = z.object({ company: z.string().trim().min(1).max(200), role: z.string().trim().min(1).max(200), description: z.string().trim().min(20).max(40000), url, instructions: z.string().max(3000) });
export const settingsSchema = z.object({ model: z.string().max(200).optional(), apiKey: z.string().trim().min(10).max(1000).optional(), clearApiKey: z.boolean().optional(), privacyMode: z.boolean().optional() });
export const questionAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  questions: z.array(z.object({ id, term: z.string().trim().min(1).max(200), sourceQuote: z.string().trim().min(1).max(1500), importance: z.enum(['required', 'preferred']), question: z.string().trim().min(1).max(1000), evidenceIds: z.array(z.string()).max(30), suggestedGroup: z.string().nullable() }).strict()).max(8),
}).strict();
export const analysisSchema = z.object({
  summary: z.string().min(1).max(3000),
  edits: z.array(z.object({ slotId: z.string(), text: z.string().min(1).max(3000), reason: z.string().min(1).max(2000), evidenceIds: z.array(z.string()).min(1).max(30) }).strict()).max(100),
  requirements: z.array(z.object({ term: z.string().min(1).max(200), sourceQuote: z.string().min(1).max(1500), importance: z.enum(['required', 'preferred']), evidenceIds: z.array(z.string()).max(30), covered: z.boolean() }).strict()).max(50),
  gaps: z.array(z.string().max(2000)).max(50), warnings: z.array(z.string().max(2000)).max(50),
  reuseSuggestion: z.object({ resumeId: z.string(), reason: z.string().min(1).max(2000) }).strict().nullable(),
}).strict();
