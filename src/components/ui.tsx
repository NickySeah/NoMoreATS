import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { AlertCircle, ArrowRight, FileText, LoaderCircle, X } from 'lucide-react'

export function Button({ children, variant = 'primary', className = '', busy = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; busy?: boolean }) {
  return <button className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || busy}>{busy ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : null}{children}</button>
}

export function Field({ label, hint, multiline = false, className = '', ...props }: { label: string; hint?: string; multiline?: boolean } & InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generatedId = useId()
  const id = props.id || generatedId
  return <label className={`field ${className}`} htmlFor={id}><span className="field-label">{label}</span>{multiline ? <textarea {...props} id={id} /> : <input {...props} id={id} />}{hint ? <span className="field-hint">{hint}</span> : null}</label>
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return <div className="notice notice-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><div>{children}</div></div>
}

export function EmptyState({ title, children, action, onAction }: { title: string; children: ReactNode; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-document" aria-hidden="true"><FileText size={58} strokeWidth={1.2} /><span /><span /><span /><span /></div><h3>{title}</h3><p>{children}</p>{action ? <button className="text-link" onClick={onAction}>{action}<ArrowRight size={17} /></button> : null}</div>
}

export function Modal({ title, children, onClose, wide = false, preventClose = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; preventClose?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const closeRef = useRef(onClose)
  const preventCloseRef = useRef(preventClose)
  closeRef.current = onClose
  preventCloseRef.current = preventClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]')
      ;(first || panel.current)?.focus()
    })
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || preventCloseRef.current) return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', escape, true)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', escape, true); document.body.style.overflow = oldOverflow; previous?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !preventClose) onClose() }}><div className={`modal ${wide ? 'modal-wide' : ''}`} ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])
    const first = elements[0], last = elements[elements.length - 1]
    if (!first) { event.preventDefault(); panel.current?.focus(); return }
    if (!elements.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }}><header className="modal-header"><h2 id={headingId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={preventClose}><X size={21} /></button></header>{children}</div></div>
}

export const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  if (date.toDateString() === new Date().toDateString()) return 'Today'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
