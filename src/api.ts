import type { Analysis, AppState, EvidenceAnswer, EvidenceReview, EvidenceSaveResult, Job, JobInput, JobStatus, ModelOption, Profile, Resume, ResumeTemplate, Settings, TailorResult } from '../shared/types'

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(detail?.error || `Request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export const api = {
  state: () => request<AppState>('/api/state'),
  profile: (profile: Profile) => request<Profile>('/api/profile', 'PUT', profile),
  settings: (settings: { model?: string; apiKey?: string; clearApiKey?: boolean; privacyMode?: boolean }) => request<Settings>('/api/settings', 'PUT', settings),
  models: () => request<{ models: ModelOption[] }>('/api/models'),
  template: (template: { path?: string; source?: string; name?: string }) => request<ResumeTemplate>('/api/template', 'POST', template),
  analyzeEvidence: (job: JobInput) => request<EvidenceReview>('/api/evidence/analyze', 'POST', { job }),
  saveEvidence: (reviewId: string, job: JobInput, answers: EvidenceAnswer[]) => request<EvidenceSaveResult>('/api/evidence/save', 'POST', { reviewId, job, answers }),
  tailor: (job: JobInput, forceNew = false, reviewId?: string) => request<TailorResult>('/api/tailor', 'POST', { job, forceNew, reviewId }),
  reuse: (job: JobInput, resumeId: string, analysis?: Analysis) => request<Job>('/api/jobs', 'POST', { job, resumeId, analysis }),
  status: (id: string, status: JobStatus) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`, 'PATCH', { status }),
  compile: (id: string) => request<Resume>(`/api/resumes/${encodeURIComponent(id)}/compile`, 'POST', {}),
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
export const resumeUrl = (id: string, format: 'tex' | 'pdf') => `/api/resumes/${encodeURIComponent(id)}/${format}`
