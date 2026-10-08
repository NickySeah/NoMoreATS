import { Check, ExternalLink, KeyRound, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ModelOption, Settings } from '../../shared/types'
import { api, errorMessage } from '../api'
import { Button, ErrorNotice, Field } from './ui'

export function SettingsPage({ settings, onChange, onNotice }: { settings: Settings; onChange: (settings: Settings) => void; onNotice: (message: string) => void }) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [privacy, setPrivacy] = useState(settings.privacyMode)
  const [models, setModels] = useState<ModelOption[]>([])
  const [query, setQuery] = useState('')
  const [modelError, setModelError] = useState('')
  const [error, setError] = useState('')
  const [loadingModels, setLoadingModels] = useState(true)
  const [busy, setBusy] = useState<'key' | 'preferences' | 'remove' | null>(null)
  const loadModels = async () => {
    setLoadingModels(true); setModelError('')
    try { setModels((await api.models()).models) } catch (failure) { setModelError(errorMessage(failure)) } finally { setLoadingModels(false) }
  }
  useEffect(() => { let mounted = true; void api.models().then(result => { if (mounted) setModels(result.models) }).catch(failure => { if (mounted) setModelError(errorMessage(failure)) }).finally(() => { if (mounted) setLoadingModels(false) }); return () => { mounted = false } }, [])
  const filtered = useMemo(() => models.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(query.toLowerCase())).slice(0, 60), [models, query])
  const selectedModel = models.find(item => item.id === model)
  const save = async (kind: 'key' | 'preferences' | 'remove') => {
    setBusy(kind); setError('')
    try {
      const saved = await api.settings(kind === 'key' ? { apiKey: apiKey.trim() } : kind === 'remove' ? { clearApiKey: true } : { model: model.trim(), privacyMode: privacy })
      onChange(saved)
      if (kind === 'key') setApiKey('')
      onNotice(kind === 'key' ? 'API key saved locally.' : kind === 'remove' ? 'Local API key removed.' : 'Model and privacy preferences saved.')
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(null) }
  }
  return <div className="page"><div className="page-heading"><div><h1>Settings</h1><p>Choose the model and connection for your next resume.</p></div><a className="button button-secondary" href="/api/export" download>Export local backup</a></div>{error ? <ErrorNotice>{error}</ErrorNotice> : null}<div className="settings-layout"><section className="panel settings-section"><div className="section-heading"><span className="section-icon"><KeyRound size={21} /></span><div><h2>OpenRouter connection</h2><p>Use your own API key for real model requests.</p></div><span className={`connection-label ${settings.apiKeyConfigured ? 'connected' : ''}`}>{settings.apiKeyConfigured ? <><Check size={14} />Connected</> : 'Not connected'}</span></div><p className="settings-copy">Your API key is saved in an ignored local server file when you choose Save key. It is stored as plain text on this computer and sent only by the backend to OpenRouter. The app never returns the key to the browser.</p>{settings.keySource === 'environment' ? <div className="notice">A key is available from the server environment.</div> : null}<div className="key-form"><Field label="OpenRouter API key" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={settings.apiKeyConfigured ? 'Enter a key to replace the saved key' : 'Paste your OpenRouter API key'} /><Button busy={busy === 'key'} disabled={!apiKey.trim() || busy !== null} onClick={() => { void save('key') }}>Save key</Button></div><div className="settings-bottom"><a className="text-link" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get an OpenRouter key<ExternalLink size={14} /></a>{settings.keySource === 'local' ? <Button variant="quiet" busy={busy === 'remove'} disabled={busy !== null} onClick={() => { void save('remove') }}>Remove local key</Button> : null}</div></section><section className="panel settings-section"><div className="section-heading"><div><h2>Model</h2><p>Select from the live catalog, or enter a model ID.</p></div><Button variant="quiet" onClick={() => { void loadModels() }} busy={loadingModels}><RefreshCw size={15} />Refresh</Button></div>{modelError ? <ErrorNotice>{modelError} You can still enter a known OpenRouter model ID below.</ErrorNotice> : null}<label className="search-input catalog-search"><Search size={17} /><input aria-label="Search OpenRouter models" placeholder="Search models by name or provider…" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="model-catalog" role="radiogroup" aria-label="OpenRouter model catalog">{loadingModels ? <p className="catalog-placeholder">Loading the live model catalog…</p> : filtered.length ? filtered.map(item => <label key={item.id} className={`model-option ${model === item.id ? 'model-selected' : ''}`}><input type="radio" name="model" value={item.id} checked={model === item.id} onChange={() => setModel(item.id)} /><span><strong>{item.name}</strong><span>{item.id}</span></span><span className="model-context">{item.context_length.toLocaleString()} context</span></label>) : <p className="catalog-placeholder">{modelError ? 'Catalog unavailable.' : 'No models match your search.'}</p>}</div><Field label="OpenRouter model ID" value={model} onChange={event => setModel(event.target.value)} placeholder="provider/model-name" hint="No model is selected by default. Select a real model before tailoring." />{selectedModel ? <p className="field-hint pricing-note">Catalog pricing per token: input ${selectedModel.pricing.prompt}, output ${selectedModel.pricing.completion}.</p> : null}<div className="privacy-setting"><ShieldCheck size={23} /><label><span className="checkbox-label"><input type="checkbox" checked={privacy} onChange={event => setPrivacy(event.target.checked)} /><strong>Privacy mode</strong></span><span>Ask OpenRouter to avoid providers that retain prompts or use them for training. This can limit available providers for a model.</span></label></div><div className="settings-actions"><Button busy={busy === 'preferences'} disabled={busy !== null} onClick={() => { void save('preferences') }}>Save model & preferences</Button></div></section></div></div>
}
