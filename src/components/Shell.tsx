import { CodeXml, File, Files, House, Menu, Settings2, UserRound, X, Check, LoaderCircle, AlertCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SaveStatus } from '../useWorkspace'

export type Page = 'overview' | 'library' | 'profile' | 'template' | 'settings'
export const pageLabels: Record<Page, string> = { overview: 'Overview', library: 'Resume library', profile: 'My profile', template: 'LaTeX template', settings: 'Settings' }
const navigation = [{ page: 'overview', icon: House }, { page: 'library', icon: Files }, { page: 'profile', icon: UserRound }, { page: 'template', icon: CodeXml }, { page: 'settings', icon: Settings2 }] as const

export function Shell({ page, onNavigate, name, saveStatus, onSave, children }: { page: Page; onNavigate: (page: Page) => void; name: string; saveStatus: SaveStatus; onSave: () => void; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const drawer = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('') || 'ME'

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMobileOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!mobileOpen || !isMobile) return
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => drawer.current?.querySelector<HTMLButtonElement>('.mobile-close')?.focus())
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = oldOverflow; menuButton.current?.focus() }
  }, [mobileOpen, isMobile])

  const move = (next: Page) => { onNavigate(next); setMobileOpen(false) }

  return <div className="app-shell">
    <aside
      id="workspace-navigation"
      ref={drawer}
      className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}
      inert={isMobile && !mobileOpen}
      aria-hidden={isMobile && !mobileOpen ? true : undefined}
      role={isMobile ? 'dialog' : undefined}
      aria-modal={isMobile && mobileOpen ? true : undefined}
      aria-label={isMobile ? 'Workspace navigation' : undefined}
      onKeyDown={event => {
        if (!isMobile || !mobileOpen) return
        if (event.key === 'Escape') { event.preventDefault(); setMobileOpen(false); return }
        if (event.key !== 'Tab') return
        const items = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') || [])
        const first = items[0], last = items[items.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}
    >
      <a className="brand" href="#overview" onClick={event => { event.preventDefault(); move('overview') }}><File size={29} strokeWidth={1.8} /><span>NoMoreATS</span></a>
      <button className="mobile-close icon-button" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
      <nav aria-label="Workspace navigation">{navigation.map(({ page: item, icon: Icon }) => <button key={item} className={`nav-item ${page === item ? 'active' : ''}`} aria-current={page === item ? 'page' : undefined} onClick={() => move(item)}><Icon size={21} strokeWidth={1.8} /><span>{pageLabels[item]}</span></button>)}</nav>
      <div className="sidebar-profile"><span className="avatar">{initials}</span><div><strong>{name || 'Your workspace'}</strong><span>Personal workspace</span></div></div>
    </aside>
    {mobileOpen && isMobile ? <button className="sidebar-scrim" tabIndex={-1} aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
    <main className="workspace" inert={isMobile && mobileOpen} aria-hidden={isMobile && mobileOpen ? true : undefined}>
      <header className="topbar">
        <div className="breadcrumb"><button ref={menuButton} className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={mobileOpen}><Menu size={22} /></button><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>{pageLabels[page]}</strong></div>
        <button className={`save-indicator save-${saveStatus}`} onClick={onSave} disabled={saveStatus === 'saved' || saveStatus === 'saving'} aria-label={saveStatus === 'error' ? 'Save failed. Retry saving profile' : saveStatus === 'dirty' ? 'Unsaved profile changes. Save now' : undefined}>
          {saveStatus === 'saving' ? <LoaderCircle size={13} className="spin" /> : saveStatus === 'error' ? <AlertCircle size={13} /> : saveStatus === 'dirty' ? <span className="status-dot dirty" /> : <span className="status-dot" />}
          {saveStatus === 'saved' ? 'Saved locally' : saveStatus === 'saving' ? 'Saving profile…' : saveStatus === 'dirty' ? 'Unsaved changes · Save now' : 'Save failed · Retry'}
          {saveStatus === 'saved' ? <Check size={12} className="sr-only" /> : null}
        </button>
      </header>
      {children}
    </main>
  </div>
}
