import { ArrowRight, Check, FileText, ShieldCheck, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Analysis, Job, JobInput, Resume, Settings, TailorResult } from '../../shared/types'
import { api, errorMessage } from '../api'
import { Button, ErrorNotice, Field, Modal } from './ui'

const blankJob: JobInput = { company: '', role: '', description: '', url: '', instructions: '' }

export function TailorModal({ settings, flushProfile, onComplete, onReuse, onClose, onSettings, reuseResume }: { settings: Settings; flushProfile: () => Promise<void>; onComplete: (result: TailorResult) => void; onReuse: (job: Job, resume: Resume) => void; onClose: () => void; onSettings: () => void; reuseResume?: Resume }) {
  const [job, setJob] = useState<JobInput>(blankJob)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState<TailorResult | null>(null)
  const configured = Boolean(reuseResume) || settings.apiKeyConfigured && Boolean(settings.model.trim())
  const generate = async (forceNew = false) => {
    setBusy(true); setError(''); setPhase('Saving your latest profile…')
    try {
      await flushProfile()
      setPhase('Reviewing the role and tailoring with your evidence…')
      const result = await api.tailor(job, forceNew)
      if (result.resume) onComplete(result)
      else if (result.suggestedResume) setSuggestion(result)
      else throw new Error('No resume was returned. Please review your profile and try again.')
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false); setPhase('') }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!configured) return; if (reuseResume) void link(reuseResume); else void generate() }
  const link = async (resume: Resume, analysis?: Analysis) => {
    setBusy(true); setError(''); setPhase('Linking this application to your existing resume…')
    try { const linked = await api.reuse(job, resume.id, analysis); onReuse(linked, resume) } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false); setPhase('') }
  }
  const reuse = async () => {
    if (!suggestion?.suggestedResume) return
    await link(suggestion.suggestedResume, suggestion.analysis)
  }
  return <Modal title={reuseResume ? 'Use this resume for a job' : suggestion ? 'An existing resume may fit' : 'Tailor a resume'} onClose={onClose} preventClose={busy}><div className="modal-body"><p className="modal-intro">{reuseResume ? `Link a new application to ${reuseResume.name}. Review this version before applying.` : 'Bring the role. We’ll match its language using experience you can support.'}</p>{error ? <ErrorNotice>{error}</ErrorNotice> : null}{!configured ? <div className="notice setup-notice"><KeySetup /><div><strong>{!settings.apiKeyConfigured ? 'Connect OpenRouter to get started.' : 'Choose your model to get started.'}</strong><p>Add your API key and select an actual model in Settings.</p><button className="text-link" onClick={onSettings}>Open Settings<ArrowRight size={15} /></button></div></div> : null}{suggestion?.suggestedResume ? <div className="reuse-suggestion"><span className="suggestion-icon"><FileText size={28} /></span><h3>{suggestion.suggestedResume.name}</h3><p>{suggestion.analysis.reuseSuggestion?.reason || suggestion.analysis.summary}</p><div className="notice"><ShieldCheck size={18} /><span>Review this version before sending it. Reuse links the new application to this resume.</span></div><div className="suggestion-actions"><Button busy={busy} disabled={busy} onClick={() => { void reuse() }}><Check size={17} />Use existing resume</Button><Button variant="secondary" busy={busy} disabled={busy} onClick={() => { void generate(true) }}>Generate a new version</Button></div><button className="text-link" disabled={busy} onClick={() => setSuggestion(null)}>Back to job details</button></div> : <form onSubmit={submit}><fieldset className="tailor-fieldset" disabled={busy}><div className="form-grid"><Field label="Company" value={job.company} required maxLength={200} placeholder="Company name" onChange={event => setJob({ ...job, company: event.target.value })} /><Field label="Role" value={job.role} required maxLength={200} placeholder="Role title" onChange={event => setJob({ ...job, role: event.target.value })} /><Field label="Job posting URL (optional)" className="full-width" value={job.url} placeholder="https://…" onChange={event => setJob({ ...job, url: event.target.value })} /><Field label="Full job description" multiline rows={9} required className="full-width" value={job.description} placeholder="Paste the full job description, including requirements and responsibilities…" onChange={event => setJob({ ...job, description: event.target.value })} /><Field label="Tailoring instructions (optional)" multiline rows={3} className="full-width" value={job.instructions} placeholder="For example, emphasise backend engineering and production experience." onChange={event => setJob({ ...job, instructions: event.target.value })} /></div></fieldset><div className="evidence-reminder"><ShieldCheck size={18} /><p>Only supported facts belong in your resume. Missing skills appear as gaps for you to review.</p></div><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={!configured || busy}><Sparkles size={17} />{reuseResume ? 'Link application' : 'Tailor this resume'}</Button></div></form>}{busy ? <div className="generation-progress" role="status"><span className="progress-pulse" /><div><strong>{phase}</strong><p>A real model request may take a little time. Keep this window open.</p></div></div> : null}</div></Modal>
}

function KeySetup() { return <ShieldCheck size={22} aria-hidden="true" /> }
