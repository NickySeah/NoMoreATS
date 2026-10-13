import { LoaderCircle, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Job, JobStatus, Resume, TailorResult } from '../shared/types'
import { api, errorMessage } from './api'
import { useWorkspace } from './useWorkspace'
import { Library } from './components/Library'
import { Overview } from './components/Overview'
import { ProfilePage } from './components/ProfilePage'
import { ResumeDetail } from './components/ResumeDetail'
import { SettingsPage } from './components/SettingsPage'
import { Shell, type Page } from './components/Shell'
import { TailorModal } from './components/TailorModal'
import { TemplatePage } from './components/TemplatePage'
import { Button, ErrorNotice } from './components/ui'

const knownPages: Page[] = ['overview', 'library', 'profile', 'template', 'settings']
function initialPage(): Page { const hash = window.location.hash.slice(1) as Page; return knownPages.includes(hash) ? hash : 'overview' }

export default function App() {
  const workspace = useWorkspace()
  const [page, setPage] = useState<Page>(initialPage)
  const [tailoring, setTailoring] = useState(false)
  const [reuseResumeId, setReuseResumeId] = useState('')
  const [selectedResume, setSelectedResume] = useState('')
  const [notice, setNotice] = useState('')
  const navigate = (next: Page) => { setPage(next); window.location.hash = next; window.scrollTo({ top: 0 }); setSelectedResume('') }
  useEffect(() => { const update = () => setPage(initialPage()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer) }, [notice])
  const save = () => { void workspace.flushProfile().catch(() => undefined) }
  const status = async (job: Job, next: JobStatus) => workspace.updateJob(await api.status(job.id, next))
  const complete = (result: TailorResult) => { workspace.addTailorResult(result); setTailoring(false); if (result.resume) setSelectedResume(result.resume.id); setNotice('Your tailored resume is saved. Review its edits and evidence before applying.') }
  const reuse = (job: Job, resume: Resume) => { workspace.updateJob(job); setTailoring(false); setReuseResumeId(''); setSelectedResume(resume.id); setNotice('Application linked to your existing resume.') }

  if (!workspace.state) return <div className="loading-screen"><div className="loading-brand">NoMoreATS</div>{workspace.loadError ? <><ErrorNotice>{workspace.loadError}</ErrorNotice><Button onClick={() => { void workspace.load().catch(() => undefined) }}>Retry loading workspace</Button></> : <><LoaderCircle className="spin" size={27} /><p>Opening your local workspace…</p></>}</div>
  const state = workspace.state
  const resume = state.resumes.find(item => item.id === selectedResume)
  return <Shell page={page} onNavigate={navigate} name={state.profile.contact.name} saveStatus={workspace.saveStatus} onSave={save}>
    {workspace.saveError && page !== 'profile' ? <div className="global-save-error"><ErrorNotice><strong>Profile changes have not been saved.</strong> {workspace.saveError}<button className="text-link" onClick={save}>Retry save</button></ErrorNotice></div> : null}
    {page === 'overview' ? <Overview state={state} onNavigate={navigate} onTailor={() => setTailoring(true)} onResume={setSelectedResume} onStatus={status} /> : null}
    {page === 'library' ? <div className="page"><div className="page-heading"><div><h1>Resume library</h1><p>Your resumes and opportunities, in one place.</p></div><Button onClick={() => setTailoring(true)}><Plus size={20} />Tailor a resume</Button></div><Library resumes={state.resumes} jobs={state.jobs} onResume={setSelectedResume} onTailor={() => setTailoring(true)} onStatus={status} /></div> : null}
    {page === 'profile' ? <ProfilePage profile={state.profile} onChange={workspace.updateProfile} saveStatus={workspace.saveStatus} saveError={workspace.saveError} onSave={workspace.flushProfile} /> : null}
    {page === 'template' ? <TemplatePage template={state.template} settings={state.settings} flushProfile={workspace.flushProfile} onImport={workspace.load} /> : null}
    {page === 'settings' ? <SettingsPage settings={state.settings} onChange={workspace.updateSettings} onNotice={setNotice} /> : null}
    {tailoring ? <TailorModal reuseResume={state.resumes.find(item => item.id === reuseResumeId)} settings={state.settings} flushProfile={workspace.flushProfile} onProfileSaved={workspace.acceptSavedProfile} onComplete={complete} onReuse={reuse} onClose={() => { setTailoring(false); setReuseResumeId('') }} onSettings={() => { setTailoring(false); navigate('settings') }} /> : null}
    {resume ? <ResumeDetail key={resume.id} resume={resume} jobs={state.jobs.filter(job => job.resumeId === resume.id)} onUpdate={workspace.updateResume} onStatus={status} onClose={() => setSelectedResume('')} onUse={() => { setReuseResumeId(resume.id); setSelectedResume(''); setTailoring(true) }} /> : null}
    {notice ? <div className="toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div> : null}
  </Shell>
}
