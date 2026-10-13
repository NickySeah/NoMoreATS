import { CheckCircle2, MessageCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { FollowupAnswer, FollowupRound, JobInput, Profile, Settings, TailorResult } from '../../shared/types'
import { api, errorMessage } from '../api'
import { Button, ErrorNotice, Field, Modal } from './ui'

export function findPendingFollowup(rounds: FollowupRound[], job: JobInput, jobId?: string): FollowupRound | undefined {
  return rounds.filter(round => !round.generatedResumeId && (jobId
    ? round.jobId === jobId
    : !round.jobId && (['company', 'role', 'description', 'url', 'instructions'] as const).every(key => round.job[key] === (key === 'company' || key === 'role' || key === 'description' ? job[key].trim() : job[key]))))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))[0]
}

export function buildFollowupAnswers(round: FollowupRound, drafts: Record<string, { text: string; group: string }>): FollowupAnswer[] {
  return round.questions.flatMap(question => {
    const answer = drafts[question.id]
    return answer?.text.trim() ? [{ questionId: question.id, text: answer.text, group: answer.group }] : []
  })
}

type Props = {
  job: JobInput
  jobId?: string
  resumeId?: string
  profile: Profile
  settings: Settings
  rounds: FollowupRound[]
  flushProfile: () => Promise<void>
  onProfile: (profile: Profile) => void
  onRound: (round: FollowupRound) => void
  onComplete: (result: TailorResult) => void
  onClose: () => void
  onSettings: () => void
}

export function FollowupModal({ job, jobId, resumeId, profile, settings, rounds, flushProfile, onProfile, onRound, onComplete, onClose, onSettings }: Props) {
  const [round, setRound] = useState(() => findPendingFollowup(rounds, job, jobId))
  const [drafts, setDrafts] = useState<Record<string, { text: string; group: string }>>({})
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const started = useRef(false)
  const configured = settings.apiKeyConfigured && Boolean(settings.model.trim())
  const groups = [
    { value: 'profile.additional', label: 'General additional evidence' },
    ...profile.experience.map(item => ({ value: `experience.${item.id}`, label: `Experience: ${item.role} at ${item.company}` })),
    ...profile.projects.map(item => ({ value: `project.${item.id}`, label: `Project: ${item.name}` })),
  ]
  const groupFor = (group: string | null) => groups.some(option => option.value === group) ? group! : 'profile.additional'
  const draftFor = (id: string, targetGroup: string | null) => drafts[id] ?? { text: '', group: groupFor(targetGroup) }
  const start = () => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true); setError('')
    return true
  }
  const finish = () => { busyRef.current = false; setBusy(false); setPhase('') }

  const ask = async () => {
    if (!configured || !start()) return
    setPhase('Saving your latest profile…')
    try {
      await flushProfile()
      setPhase('Finding job-specific questions about your experience…')
      const next = await api.followup(job, { jobId, resumeId })
      setRound(next); setDrafts({}); if (next.questions.length) onRound(next)
    } catch (failure) { setError(errorMessage(failure)) } finally { finish() }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!round && configured) void ask()
  }, [])

  const regenerate = async (saved: FollowupRound) => {
    setPhase('Creating and verifying a new one-page resume…')
    const result = await api.tailor(saved.job, true, { jobId: saved.jobId ?? jobId, ...(saved.questions.length ? { followupId: saved.id } : {}) })
    if (!result.resume) throw new Error('No new resume was returned. Your saved answers are ready to use when you retry.')
    const completed = { ...saved, generatedResumeId: result.resume.id, generatedJobId: result.job.id }
    setRound(completed); if (saved.questions.length) onRound(completed); onComplete(result)
  }

  const saveAndGenerate = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!round || !configured || !start()) return
    try {
      setPhase('Saving your latest profile…')
      await flushProfile()
      let saved = round
      if (!round.answeredAt && round.questions.length) {
        setPhase('Saving your answers to your profile…')
        const answers = buildFollowupAnswers(round, Object.fromEntries(round.questions.map(question => [question.id, draftFor(question.id, question.targetGroup)])))
        const response = await api.answerFollowup(round.id, answers)
        onProfile(response.profile)
        saved = response.round
        setRound(saved); onRound(saved)
      }
      await regenerate(saved)
    } catch (failure) { setError(errorMessage(failure)) } finally { finish() }
  }

  return <Modal title="Improve with AI questions" onClose={onClose} preventClose={busy}>
    <div className="modal-body followup-body">
      <p className="followup-job"><strong>{job.role}</strong><span>{job.company}</span></p>
      <p className="modal-intro">Answer focused questions about this job in your own words. Choose the role or project each answer belongs to, or save it as general evidence. Leave any question blank to skip it.</p>
      {!configured ? <div className="notice setup-notice"><ShieldCheck size={22} /><div><strong>Connect OpenRouter and choose a model in Settings.</strong><p>Your saved questions and answers will stay in this workspace.</p><button className="text-link" onClick={onSettings}>Open Settings</button></div></div> : null}
      {round?.answeredAt ? <div className="notice followup-saved" role="status"><CheckCircle2 size={20} /><div><strong>{round.answers.length ? 'Saved to profile' : 'Questions skipped'}</strong><p>{round.answers.length ? 'Your answers are saved with their selected attribution. Retrying only generates the resume.' : 'No evidence was added. You can generate using your existing profile.'}</p></div></div> : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {round?.answeredAt && round.answers.length ? <div className="followup-saved-answers">{round.answers.map(answer => <article key={answer.questionId}><h3>{round.questions.find(question => question.id === answer.questionId)?.question}</h3><p>{answer.text}</p><span>{groups.find(group => group.value === answer.group)?.label || answer.group}</span></article>)}</div> : null}
      {round && !round.answeredAt ? <form onSubmit={event => { void saveAndGenerate(event) }}>
        <fieldset className="tailor-fieldset" disabled={busy || !configured}>
          {round.questions.length ? <div className="followup-questions">{round.questions.map((question, index) => {
            const answer = draftFor(question.id, question.targetGroup)
            return <article className="followup-question" key={question.id}>
              <div className="followup-question-heading"><span>{index + 1}</span><h3>{question.question}</h3></div>
              <blockquote><span>From the job description</span>{question.sourceQuote}</blockquote>
              <p className="followup-reason">{question.reason}</p>
              <Field id={`answer-${question.id}`} label={`Your answer ${index + 1} (optional)`} multiline rows={4} maxLength={6000} value={answer.text} placeholder="Describe what you did, your contribution, and any factual results. It is okay if you have no experience with this." onChange={event => setDrafts(current => ({ ...current, [question.id]: { ...answer, text: event.target.value } }))} />
              <label className="field followup-attribution"><span className="field-label">Save answer {index + 1} to</span><select aria-label={`Save answer ${index + 1} to`} value={answer.group} onChange={event => setDrafts(current => ({ ...current, [question.id]: { ...answer, group: event.target.value } }))}>{groups.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}</select><span className="field-hint">General evidence stays separate from role and project accomplishments.</span></label>
            </article>
          })}</div> : <div className="followup-empty"><MessageCircle size={30} /><h3>No further questions for this job.</h3><p>The AI has no additional questions to ask. Generate a new version using your current evidence.</p></div>}
        </fieldset>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Close</Button><Button type="submit" busy={busy} disabled={busy || !configured}><Sparkles size={17} />{round.questions.length ? 'Save answers & generate' : 'Generate resume'}</Button></div>
      </form> : <div className="modal-actions"><Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>{round?.answeredAt ? <Button busy={busy} disabled={!configured || busy} onClick={() => { void saveAndGenerate() }}><RefreshCw size={17} />{error ? 'Retry resume generation' : 'Generate resume'}</Button> : <Button busy={busy} disabled={!configured || busy} onClick={() => { void ask() }}><MessageCircle size={17} />{error ? 'Retry questions' : 'Generate questions'}</Button>}</div>}
      {busy ? <div className="generation-progress" role="status"><span className="progress-pulse" /><div><strong>{phase}</strong><p>A real model request may take a little time. Keep this window open.</p></div></div> : null}
    </div>
  </Modal>
}
