import { ArrowRight, Check, FileText, ShieldCheck, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Analysis, EvidenceAnswer, EvidenceReview, Profile, Job, JobInput, Resume, Settings, TailorResult } from '../../shared/types'
import { api, errorMessage } from '../api'
import { Button, ErrorNotice, Field, Modal } from './ui'

const blankJob: JobInput = { company: '', role: '', description: '', url: '', instructions: '' }

export function TailorModal({ settings, flushProfile, onProfileSaved, onComplete, onReuse, onClose, onSettings, reuseResume }: { settings: Settings; flushProfile: () => Promise<void>; onProfileSaved: (profile: Profile) => void; onComplete: (result: TailorResult) => void; onReuse: (job: Job, resume: Resume) => void; onClose: () => void; onSettings: () => void; reuseResume?: Resume }) {
  const [job, setJob] = useState<JobInput>(blankJob)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [review, setReview] = useState<EvidenceReview | null>(null)
  const [answers, setAnswers] = useState<EvidenceAnswer[]>([])
  const [saved, setSaved] = useState(false)
  const [suggestion, setSuggestion] = useState<TailorResult | null>(null)
  const configured = Boolean(reuseResume) || settings.apiKeyConfigured && Boolean(settings.model.trim())
  const generate = async (forceNew = false) => {
    setBusy(true); setError(''); setPhase('Saving your latest profile…')
    try {
      await flushProfile()
      setPhase('Selecting relevant evidence and verifying the one-page layout…')
      const result = await api.tailor(job, forceNew, review?.reviewId)
      if (result.resume) onComplete(result)
      else if (result.suggestedResume) setSuggestion(result)
      else throw new Error('No resume was returned. Please review your profile and try again.')
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false); setPhase('') }
  }
  const analyze = async () => {
    setBusy(true); setError(''); setPhase('Comparing job requirements with your full saved profile…')
    try {
      await flushProfile()
      const result = await api.analyzeEvidence(job)
      setReview(result); setSaved(false)
      setAnswers(result.questions.map(question => ({ questionId: question.id, disposition: 'skip', text: '', group: null })))
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false); setPhase('') }
  }
  const saveAnswers = async () => {
    if (!review) return
    setBusy(true); setError(''); setPhase('Saving only your confirmed factual answers…')
    try {
      const result = await api.saveEvidence(review.reviewId, job, answers)
      onProfileSaved(result.profile); setSaved(true)
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false); setPhase('') }
  }
  const back = () => { setReview(null); setSuggestion(null); setSaved(false); setAnswers([]); setError('') }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!configured) return; if (reuseResume) void link(reuseResume); else void analyze() }
  const link = async (resume: Resume, analysis?: Analysis) => {
    setBusy(true); setError(''); setPhase('Linking this application to your existing resume…')
    try { const linked = await api.reuse(job, resume.id, analysis); onReuse(linked, resume) } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false); setPhase('') }
  }
  const reuse = async () => {
    if (!suggestion?.suggestedResume) return
    await link(suggestion.suggestedResume, suggestion.analysis)
  }
  return <Modal title={reuseResume ? 'Use this resume for a job' : suggestion ? 'An existing resume may fit' : review ? 'Review your evidence' : 'Tailor a resume'} onClose={onClose} preventClose={busy}><div className="modal-body"><p className="modal-intro">{reuseResume ? `Link a new application to ${reuseResume.name}. Review this version before applying.` : 'Analyze the job against your full profile first. Review any missing details and explicitly save factual answers before generating. Analysis and generation are separate paid OpenRouter requests using your privacy settings.'}</p>{error ? <ErrorNotice>{error}</ErrorNotice> : null}{!configured ? <div className="notice setup-notice"><KeySetup /><div><strong>{!settings.apiKeyConfigured ? 'Connect OpenRouter to get started.' : 'Choose your model to get started.'}</strong><p>Add your API key and select an actual model in Settings.</p><button className="text-link" onClick={onSettings}>Open Settings<ArrowRight size={15} /></button></div></div> : null}{suggestion?.suggestedResume ? <div className="reuse-suggestion"><span className="suggestion-icon"><FileText size={28} /></span><h3>{suggestion.suggestedResume.name}</h3><p>{suggestion.analysis.reuseSuggestion?.reason || suggestion.analysis.summary}</p><div className="notice"><ShieldCheck size={18} /><span>Review this version before sending it. Reuse links the new application to this resume.</span></div><div className="suggestion-actions"><Button busy={busy} disabled={busy} onClick={() => { void reuse() }}><Check size={17} />Use existing resume</Button><Button variant="secondary" busy={busy} disabled={busy} onClick={() => { void generate(true) }}>Generate a new version</Button></div><button className="text-link" disabled={busy} onClick={back}>Back to job details</button></div> : review ? <section className="evidence-review" aria-label="Evidence questions"><h3>{job.company} · {job.role}</h3><p>{review.summary}</p>{!review.questions.length ? <div className="notice"><ShieldCheck size={18} /><span>No additional questions. Review the job and your existing evidence before continuing.</span></div> : null}<fieldset className="tailor-fieldset" disabled={busy || saved}>{review.questions.map((question, index) => {
    const answer = answers[index]
    return <div className="record-editor" key={question.id}><h3>{question.term}</h3><p>{question.question}</p><blockquote>{question.sourceQuote}</blockquote><label className="field"><span className="field-label">Response for {question.term}</span><select value={answer.disposition} onChange={event => setAnswers(current => current.map((item, i) => i === index ? { ...item, disposition: event.target.value as EvidenceAnswer['disposition'], text: '', group: null } : item))}><option value="skip">Skip for now</option><option value="no-experience">No experience</option><option value="answer">I have relevant experience</option></select></label>{answer.disposition === 'answer' ? <div className="form-grid"><Field label="Your factual answer" multiline rows={4} maxLength={3000} className="full-width" value={answer.text} onChange={event => setAnswers(current => current.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} hint="Describe what you personally did, tools used and the role or project. Only write facts you can substantiate." /><label className="field full-width"><span className="field-label">Save to existing entry</span><select value={answer.group || ''} onChange={event => setAnswers(current => current.map((item, i) => i === index ? { ...item, group: event.target.value || null } : item))}><option value="">Choose where this actually happened…</option>{review.groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select><span className="field-hint">Select the actual role, project or skill category, not the closest-sounding entry. {question.suggestedGroup ? `Suggested: ${review.groups.find(group => group.id === question.suggestedGroup)?.label}. Please verify.` : ''}</span></label></div> : <p className="field-hint">{answer.disposition === 'no-experience' ? 'This remains a qualification gap; no positive claim will be saved.' : 'No answer or positive claim will be saved.'}</p>}</div>
  })}</fieldset>{saved ? <div className="notice" role="status"><ShieldCheck size={18} /><span>Confirmed answers saved to your profile.</span></div> : <div className="evidence-reminder"><ShieldCheck size={18} /><p>Saving appends your exact answers to the selected entries; existing notes stay intact. No experience and skipped questions do not become claims. New entries must be added in My profile first.</p></div>}<div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={back}>Back to job details</Button>{saved ? <Button busy={busy} disabled={busy || !configured} onClick={() => { void generate() }}><Sparkles size={17} />Generate resume</Button> : <Button busy={busy} disabled={busy || answers.some(answer => answer.disposition === 'answer' && (!answer.text.trim() || !answer.group))} onClick={() => { void saveAnswers() }}>{answers.some(answer => answer.disposition === 'answer') ? 'Save confirmed answers' : 'Confirm review'}</Button>}</div></section> : <form onSubmit={submit}><fieldset className="tailor-fieldset" disabled={busy}><div className="form-grid"><Field label="Company" value={job.company} required maxLength={200} placeholder="Company name" onChange={event => setJob({ ...job, company: event.target.value })} /><Field label="Role" value={job.role} required maxLength={200} placeholder="Role title" onChange={event => setJob({ ...job, role: event.target.value })} /><Field label="Job posting URL (optional)" className="full-width" value={job.url} placeholder="https://…" onChange={event => setJob({ ...job, url: event.target.value })} /><Field label="Full job description" multiline rows={9} required className="full-width" value={job.description} placeholder="Paste the full job description, including requirements and responsibilities…" onChange={event => setJob({ ...job, description: event.target.value })} /><Field label="Tailoring instructions (optional)" multiline rows={3} className="full-width" value={job.instructions} placeholder="For example, emphasise backend engineering and production experience." onChange={event => setJob({ ...job, instructions: event.target.value })} /></div></fieldset><div className="evidence-reminder"><ShieldCheck size={18} /><p>The AI can replace less relevant accomplishments with stronger evidence from the same role or project. Only a verified one-page resume is saved; missing qualifications appear as gaps.</p></div><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={!configured || busy}><Sparkles size={17} />{reuseResume ? 'Link application' : 'Analyze job requirements'}</Button></div></form>}{busy ? <div className="generation-progress" role="status"><span className="progress-pulse" /><div><strong>{phase}</strong><p>A real model request may take a little time. Keep this window open.</p></div></div> : null}</div></Modal>
}

function KeySetup() { return <ShieldCheck size={22} aria-hidden="true" /> }
