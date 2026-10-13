import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Analysis, FollowupRound, Job, Profile, Resume, Settings } from '../shared/types'
import { ResumeDetail } from '../src/components/ResumeDetail'
import { TailorModal } from '../src/components/TailorModal'
import { Library } from '../src/components/Library'
import { buildFollowupAnswers, findPendingFollowup, FollowupModal } from '../src/components/FollowupModal'

const profile: Profile = {
  contact: { name: 'Test User', email: '', phone: '', location: '', website: '', linkedin: '', github: '' },
  summary: '', experience: [{ id: 'role-1', role: 'Engineer', company: 'Example', dates: '2024', url: '', bullets: ['Evidence from the earlier version.'], notes: '' }],
  projects: [], education: [], skills: [], certifications: [], additionalEvidence: '', updatedAt: '',
}
const analysis: Analysis = { summary: 'Earlier resume assessment.', edits: [], requirements: [{ term: 'APIs', sourceQuote: 'Build APIs', importance: 'required', evidenceIds: ['experience.role-1.bullet.0'], covered: true }], gaps: [], warnings: [], reuseSuggestion: null }
const resume: Resume = { id: 'old-resume', name: 'Earlier resume', createdAt: '2026-10-01', kind: 'tailored', templateId: 'template', templateHash: 'hash', templateSnapshot: { id: 'template', name: 'Template', source: '', sourceHash: 'hash', slots: [], importedAt: '', baselinePages: 1 }, profileSnapshot: profile, latex: '', analysis, pdf: { status: 'ready', pages: 1, message: '', warnings: [] }, model: null }
const job: Job = { id: 'job-1', company: 'Example', role: 'Engineer', description: 'Build APIs', url: '', instructions: '', resumeId: 'new-resume', resumeHistory: ['old-resume'], status: 'Applied', createdAt: '2026-10-01', analysis: { ...analysis, summary: 'Latest resume assessment.' }, evidenceSnapshot: [{ id: 'experience.role-1.bullet.0', text: 'Evidence from the latest version.', group: 'experience.role-1' }] }
const settings: Settings = { model: 'test/model', apiKeyConfigured: true, keySource: 'local', templatePath: '', privacyMode: true }
const noop = () => undefined

describe('follow-up entry and previous resume versions', () => {
  it('shows the earlier resume evidence and analysis when the linked application has a newer resume', () => {
    const html = renderToStaticMarkup(createElement(ResumeDetail, { resume, jobs: [job], onUpdate: noop, onStatus: async () => undefined, onClose: noop, onUse: noop }))
    expect(html).toContain('Earlier resume assessment.')
    expect(html).toContain('Evidence from the earlier version.')
    expect(html).not.toContain('Latest resume assessment.')
    expect(html).not.toContain('Evidence from the latest version.')
  })

  it('uses the remote evidence review before generating a new resume', () => {
    const html = renderToStaticMarkup(createElement(TailorModal, { settings, flushProfile: async () => undefined, onProfileSaved: noop, onComplete: noop, onReuse: noop, onClose: noop, onSettings: noop }))
    expect(html).toContain('Analyze job requirements')
    expect(html).not.toContain('Ask me questions first')
  })

  it('keeps reuse as a direct application link without the guided generation option', () => {
    const html = renderToStaticMarkup(createElement(TailorModal, { reuseResume: resume, settings, flushProfile: async () => undefined, onProfileSaved: noop, onComplete: noop, onReuse: noop, onClose: noop, onSettings: noop }))
    expect(html).toContain('Link application')
    expect(html).not.toContain('Ask me questions first')
  })

  it('keeps the linked opportunity visible on an earlier resume in the library', () => {
    const html = renderToStaticMarkup(createElement(Library, { resumes: [resume], jobs: [job], onResume: noop, onTailor: noop, onStatus: async () => undefined }))
    expect(html).toContain('Example · Engineer')
    expect(html).not.toContain('No applications yet')
  })

})

const round: FollowupRound = { id: 'round-1', job, jobId: job.id, resumeId: resume.id, createdAt: '2026-10-08T01:00:00.000Z', answeredAt: null, questions: [{ id: 'q-1', question: 'Which API work did you do?', reason: 'Clarify your contribution.', sourceQuote: 'Build APIs', targetGroup: 'experience.role-1' }], answers: [] }
const followupProps = { job, jobId: job.id, resumeId: resume.id, profile, settings, rounds: [round], flushProfile: async () => undefined, onProfile: noop, onRound: noop, onComplete: noop, onClose: noop, onSettings: noop }

describe('follow-up answers and resumption', () => {
  it('lets the user attribute a quoted job-specific question to an existing role or general evidence', () => {
    const html = renderToStaticMarkup(createElement(FollowupModal, followupProps))
    expect(html).toContain('Build APIs')
    expect(html).toContain('Clarify your contribution.')
    expect(html).toContain('Experience: Engineer at Example')
    expect(html).toContain('General additional evidence')
    expect(html).toContain('value="experience.role-1" selected=""')
    expect(html).toContain('<textarea')
  })

  it('shows saved answers on a pending regeneration without allowing duplicate answer submission', () => {
    const saved = { ...round, answeredAt: '2026-10-08T01:01:00.000Z', answers: [{ questionId: 'q-1', text: 'I built the API endpoints.', group: 'experience.role-1' }] }
    const html = renderToStaticMarkup(createElement(FollowupModal, { ...followupProps, rounds: [saved] }))
    expect(html).toContain('Saved to profile')
    expect(html).toContain('I built the API endpoints.')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('Save answers &amp; generate')
  })

  it('omits blank answers and preserves the exact submitted text and chosen attribution', () => {
    const next = { ...round, questions: [...round.questions, { ...round.questions[0], id: 'q-2' }] }
    expect(buildFollowupAnswers(next, { 'q-1': { text: '  I built APIs.\n', group: 'profile.additional' }, 'q-2': { text: '\n ', group: 'experience.role-1' } })).toEqual([{ questionId: 'q-1', text: '  I built APIs.\n', group: 'profile.additional' }])
  })

  it('resumes the latest incomplete round for the selected application and ignores completed or other-job rounds', () => {
    const later = { ...round, id: 'round-2', createdAt: '2026-10-08T02:00:00.000Z', answeredAt: '2026-10-08T02:01:00.000Z' }
    expect(findPendingFollowup([{ ...later, id: 'other', jobId: 'other-job', createdAt: '2026-10-08T03:00:00.000Z' }, { ...later, id: 'completed', generatedResumeId: 'new-resume' }, round, later], job, job.id)?.id).toBe('round-2')
  })

  it('resumes initial questions when job fields have the surrounding whitespace removed by the server', () => {
    expect(findPendingFollowup([{ ...round, jobId: null }], { ...job, company: ' Example ', role: ' Engineer ', description: ' Build APIs\n' })?.id).toBe('round-1')
  })
})
