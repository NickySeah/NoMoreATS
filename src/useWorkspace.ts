import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, Job, Profile, Resume, Settings, TailorResult } from '../shared/types'
import { api, errorMessage } from './api'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export function useWorkspace() {
  const [state, setState] = useState<AppState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [saveError, setSaveError] = useState('')
  const profileRef = useRef<Profile | null>(null)
  const revision = useRef(0)
  const savedRevision = useRef(0)
  const pending = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = useRef(true)
  const loadRequest = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadRequest.current
    const revisionAtStart = revision.current
    const dirtyAtStart = savedRevision.current < revision.current
    setLoadError('')
    try {
      const next = await api.state()
      if (!active.current || requestId !== loadRequest.current) return
      const preserveEdits = dirtyAtStart || revision.current !== revisionAtStart
      if (!preserveEdits) {
        profileRef.current = next.profile
        revision.current = 0
        savedRevision.current = 0
        setSaveStatus('saved')
      }
      setState({ ...next, profile: preserveEdits && profileRef.current ? profileRef.current : next.profile })
    } catch (error) { if (active.current && requestId === loadRequest.current) setLoadError(errorMessage(error)); throw error }
  }, [])

  useEffect(() => {
    active.current = true
    void load().catch(() => undefined)
    return () => { active.current = false; if (timer.current) clearTimeout(timer.current) }
  }, [load])

  const flushProfile = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    while (pending.current) await pending.current
    if (!profileRef.current || savedRevision.current === revision.current) return
    const operation = async () => {
      while (profileRef.current && savedRevision.current < revision.current) {
        const savingRevision = revision.current
        const snapshot = profileRef.current
        if (active.current) { setSaveStatus('saving'); setSaveError('') }
        try {
          const saved = await api.profile(snapshot)
          savedRevision.current = savingRevision
          if (revision.current === savingRevision) {
            profileRef.current = saved
            if (active.current) setState(current => current ? { ...current, profile: saved } : current)
          }
          if (active.current) setSaveStatus(savedRevision.current === revision.current ? 'saved' : 'dirty')
        } catch (error) {
          if (active.current) { setSaveStatus('error'); setSaveError(errorMessage(error)) }
          throw error
        }
      }
    }
    const flight = operation()
    pending.current = flight
    try { await flight } finally { if (pending.current === flight) pending.current = null }
  }, [])

  const updateProfile = useCallback((profile: Profile) => {
    profileRef.current = profile
    revision.current += 1
    setState(current => current ? { ...current, profile } : current)
    setSaveStatus('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flushProfile().catch(() => undefined) }, 800)
  }, [flushProfile])

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (savedRevision.current === revision.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnUnsaved)
    return () => window.removeEventListener('beforeunload', warnUnsaved)
  }, [])

  const updateSettings = useCallback((settings: Settings) => setState(current => current ? { ...current, settings } : current), [])
  const updateResume = useCallback((resume: Resume) => setState(current => current ? { ...current, resumes: current.resumes.map(item => item.id === resume.id ? resume : item) } : current), [])
  const updateJob = useCallback((job: Job) => setState(current => current ? { ...current, jobs: current.jobs.some(item => item.id === job.id) ? current.jobs.map(item => item.id === job.id ? job : item) : [job, ...current.jobs] } : current), [])
  const addTailorResult = useCallback((result: TailorResult) => setState(current => {
    if (!current) return current
    return { ...current, resumes: result.resume && !current.resumes.some(item => item.id === result.resume?.id) ? [result.resume, ...current.resumes] : current.resumes, jobs: current.jobs.some(item => item.id === result.job.id) ? current.jobs.map(item => item.id === result.job.id ? result.job : item) : [result.job, ...current.jobs] }
  }), [])

  return { state, loadError, load, saveStatus, saveError, updateProfile, flushProfile, updateSettings, updateResume, updateJob, addTailorResult }
}
