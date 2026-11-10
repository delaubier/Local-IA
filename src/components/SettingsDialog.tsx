import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react'
import { normalizeModelSettings, type ImportedModel, type ModelSettings } from '../utils/modelSettings'
import { AUDIO_MODELS } from '../utils/audioModels'
import { tr, type InterfaceLanguage } from '../utils/i18n'
import { WEB_PROVIDERS, type WebProvider, type WebSettings } from '../utils/webProviders'

export type SettingsAction = 'reset' | 'models' | 'conversations' | 'model' | 'audio-model'

function NumberSetting({ value, label, min, max, step = 1, help, onChange }: {
  value: number; label: string; min: number; max: number; step?: number; help?: string; onChange: (value: number) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { if (document.activeElement !== ref.current) setRaw(String(value)) }, [value])
  return <label className="setting-field"><span>{tr(label)}</span>
    <input ref={ref} type="number" value={raw} min={min} max={max} step={step} onChange={event => {
      setRaw(event.currentTarget.value)
      if (event.currentTarget.value !== '' && event.currentTarget.validity.valid) onChange(event.currentTarget.valueAsNumber)
    }} onBlur={() => setRaw(String(value))} />
    {help && <small>{tr(help)}</small>}
  </label>
}

function WebSettingsSection({ settings, onChange }: { settings: WebSettings; onChange: (settings: WebSettings) => void }) {
  const { provider, keys, endpoints } = settings
  const api = provider !== 'local' && provider !== 'local-jina'
  const custom = provider === 'searxng' || provider === 'custom'
  const descriptions: Record<WebProvider, string> = {
    local: 'LocalAI interroge les moteurs de recherche et lit les pages directement depuis le navigateur.',
    'local-jina': 'Si la lecture directe échoue, Jina Reader reçoit jusqu’à deux URL publiques par recherche pour tenter de lire les pages.',
    tavily: 'La requête de recherche est envoyée à Tavily. Sans clé, le mode d’essai est utilisé.',
    brave: 'La requête de recherche est envoyée à Brave. Une clé API est requise.',
    exa: 'La requête de recherche est envoyée à Exa. Une clé API est requise.',
    searxng: 'La requête est envoyée à votre instance SearXNG, qui doit autoriser le format JSON.',
    custom: 'L’API reçoit une requête GET avec le paramètre q et doit renvoyer un objet JSON results contenant des résultats url, title et snippet.',
  }
  return <section className="settings-web-section">
    <h3>{tr('Recherche web')}</h3>
    <label className="setting-field">
      <span>{tr('Fournisseur de recherche')}</span>
      <select value={provider} onChange={event => onChange({ ...settings, provider: event.currentTarget.value as WebProvider })}>
        {Object.entries(WEB_PROVIDERS).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}
      </select>
      <small>{tr(descriptions[provider])}</small>
    </label>
    {custom && <label className="setting-field">
      <span>{tr('Adresse du service')}</span>
      <input type="url" value={endpoints[provider] ?? ''} placeholder={provider === 'searxng' ? 'http://localhost:8080' : 'https://example.com/search'} spellCheck={false} autoComplete="off"
        onChange={event => onChange({ ...settings, endpoints: { ...endpoints, [provider]: event.currentTarget.value }, keys: { ...keys, [provider]: '' } })} />
    </label>}
    {api && <label className="setting-field">
      <span>{tr(provider === 'brave' || provider === 'exa' ? 'Clé API' : 'Clé API facultative')}</span>
      <input type="password" value={keys[provider] ?? ''} spellCheck={false} autoComplete="off"
        onChange={event => onChange({ ...settings, keys: { ...keys, [provider]: event.currentTarget.value } })} />
      <small>{tr('La clé est enregistrée dans ce profil de navigateur.')}</small>
    </label>}
  </section>
}

export function SettingsDialog({ open, onClose, language, onLanguage, models, selectedModelId, settings, onSave, onSelect, onImport, busy, audioModelId, onAudioModel, onAction, web, onWeb }: {
  open: boolean; onClose: () => void; language: InterfaceLanguage; onLanguage: (language: InterfaceLanguage) => void
  models: ImportedModel[]; selectedModelId: string; settings: Record<string, ModelSettings>; busy: boolean
  onSave: (id: string, settings: ModelSettings) => void; onSelect: (id: string) => void; onImport: (file: File) => void
  audioModelId: string; onAudioModel: (id: string) => void; onAction: (action: SettingsAction) => Promise<void>
  web: WebSettings; onWeb: (settings: WebSettings) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), confirmation = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<SettingsAction | null>(null)
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null)
  const modelId = selectedModelId, draft = normalizeModelSettings(settings[modelId])
  const name = models.find(model => model.id === modelId)?.name ?? 'LFM3'
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); else if (!open) dialog.current?.close() }, [open])
  useEffect(() => { if (confirm && !confirmation.current?.open) confirmation.current?.showModal(); else if (!confirm) confirmation.current?.close() }, [confirm])
  const change = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) => onSave(modelId, normalizeModelSettings({ ...draft, [key]: value }))
  const number = (key: keyof ModelSettings, label: string, min: number, max: number, step = 1, help?: string) => <NumberSetting key={`${modelId}-${key}`} value={draft[key] as number} label={label} min={min} max={max} step={step} help={help} onChange={value => change(key, value)} />
  const danger = (action: SettingsAction, label: string, Icon = Trash2) => <button type="button" className="settings-danger-button" disabled={busy || working} onClick={() => { setError(null); setConfirm(action) }}><Icon size={15} />{tr(label)}</button>
  const titles = { reset: 'Réinitialiser tous les paramètres ?', models: 'Supprimer tous les modèles ?', conversations: 'Supprimer toutes les conversations ?', model: 'Supprimer ce modèle ?', 'audio-model': 'Supprimer ce modèle de dictée ?' }
  const descriptions = {
    reset: 'Les réglages reviendront aux valeurs initiales et les clés API seront effacées. Les modèles téléchargés et les conversations seront conservés.',
    models: 'Le cache de tous les modèles de LocalAI sera supprimé et les moteurs arrêtés. Il faudra télécharger ou importer les modèles à nouveau.',
    conversations: 'Toutes les conversations de cet appareil seront supprimées définitivement. Cette action est irréversible.',
    model: 'Les fichiers de ce modèle seront supprimés de cet appareil. Un modèle importé sera aussi retiré de la liste.',
    'audio-model': 'Les fichiers de ce modèle de dictée seront supprimés. Vous pourrez le télécharger à nouveau.',
  }
  return <>
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); if (!working) onClose() }} onClose={() => { if (open) onClose() }}>
      <header className="settings-heading"><button type="button" className="header-icon" onClick={onClose} disabled={working} aria-label={tr('Retour à la conversation')}><ArrowLeft size={20} /></button><div><h2 id="settings-title">{tr('Paramètres')}</h2><small>{tr('Modifications appliquées automatiquement.')}</small></div></header>
      <div className="settings-body">
        <label className="setting-field setting-language"><span>{tr('Langue de l’interface')}</span><select value={language} onChange={event => onLanguage(event.currentTarget.value as InterfaceLanguage)}><option value="fr">Français</option><option value="en">English</option></select></label>
        <WebSettingsSection settings={web} onChange={onWeb} />
        <section className="settings-model-card">
          <label className="setting-field"><span>{tr('Modèle de conversation')}</span><select value={modelId} disabled={busy || working} onChange={event => onSelect(event.currentTarget.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          <input ref={fileInput} type="file" accept=".gguf" hidden aria-label={tr('Importer mon fichier GGUF')} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) { onImport(file); onClose() } event.currentTarget.value = '' }} />
          <button type="button" className="import-model-button" disabled={busy || working} onClick={() => fileInput.current?.click()}><Upload size={15} />{tr('Importer mon fichier GGUF')}</button><small>{tr('Fichier local uniquement. Le moteur doit prendre en charge son architecture.')}</small>
        </section>
        <section className="settings-audio-section"><h3>{tr('Dictée vocale')}</h3><label className="setting-field"><span>{tr('Modèle de dictée')}</span><select value={audioModelId} disabled={busy || working} onChange={event => onAudioModel(event.currentTarget.value)}>{AUDIO_MODELS.map(model => <option key={model.id} value={model.id}>{model.name} — {tr(model.description)}</option>)}</select></label><p>{tr('La langue est détectée à partir de votre voix. Le texte reste dans la langue parlée.')}</p>{danger('audio-model', 'Supprimer ce modèle de dictée')}</section>
        <fieldset className="settings-model-fields" disabled={busy || working}>
          <legend className="settings-section-title">{tr('Réglages du modèle')} · {name}</legend>
          <label className="setting-field"><span>{tr('Instruction système')}</span><textarea rows={3} value={draft.systemPrompt} maxLength={32000} placeholder={tr('Vide par défaut')} onChange={event => change('systemPrompt', event.currentTarget.value)} /></label>
          <details className="settings-section" open><summary>{tr('Génération')}</summary><div className="settings-grid">
            {number('temperature', 'Température', 0, 2, .01)}{number('topK', 'Top-k', 0, 1000)}
            {number('topP', 'Top-p', .01, 1, .01)}{number('minP', 'Min-p', 0, 1, .01)}
            {number('repeatPenalty', 'Pénalité de répétition', .5, 2, .01)}{number('repeatLastN', 'Fenêtre de répétition', -1, 32768)}
            {number('presencePenalty', 'Pénalité de présence', -2, 2, .01)}{number('frequencyPenalty', 'Pénalité de fréquence', -2, 2, .01)}
            {number('seed', 'Graine aléatoire', -1, 2147483647, 1, '−1 : aléatoire')}
          </div></details>
          <details className="settings-section" open><summary>{tr('Contexte')}</summary><div className="settings-grid">{number('contextLength', 'Tokens de contexte', 512, 262144)}{number('maxOutputTokens', 'Tokens de sortie maximum', 1, Math.min(131072, draft.contextLength - 128))}</div><small>{tr('Un contexte plus grand utilise davantage de mémoire.')}</small></details>
          <details className="settings-section"><summary>{tr('Réflexion')}</summary><label className="setting-check"><input type="checkbox" checked={draft.reasoningBudget === -1} onChange={event => change('reasoningBudget', event.currentTarget.checked ? -1 : Math.min(1024, draft.maxOutputTokens - 1))} />{tr('Sans limite spécifique')}</label>{draft.reasoningBudget !== -1 && number('reasoningBudget', 'Tokens de réflexion maximum', 0, draft.maxOutputTokens - 1)}<small>{tr('Le budget de sortie inclut la réflexion et la réponse finale.')}</small></details>
          <details className="settings-section"><summary>{tr('Avancé')}</summary><div className="settings-grid">{number('threads', 'Threads CPU', 1, 64)}{number('batchSize', 'Taille de batch', 16, 2048)}{number('microBatchSize', 'Microbatch', 16, Math.min(512, draft.batchSize))}</div><label className="setting-check"><input type="checkbox" checked={draft.flashAttention} onChange={event => change('flashAttention', event.currentTarget.checked)} />{tr('Flash Attention')}</label><label className="setting-field"><span>{tr('Séquences d’arrêt')}</span><textarea rows={2} value={draft.stopSequences} placeholder={tr('Une séquence par ligne')} onChange={event => change('stopSequences', event.currentTarget.value)} /></label></details>
        </fieldset>
        {danger('model', 'Supprimer ce modèle')}
        <section className="settings-data-section"><h3>{tr('Données sur cet appareil')}</h3>{danger('reset', 'Réinitialiser tous les paramètres', RotateCcw)}{danger('models', 'Supprimer tous les modèles')}{danger('conversations', 'Supprimer toutes les conversations')}</section>
        {error && <p role="alert" className="settings-error">{error}</p>}
      </div>
    </dialog>
    <dialog ref={confirmation} className="settings-confirm-dialog" aria-labelledby="settings-confirm-title" onCancel={event => { event.preventDefault(); if (!working) setConfirm(null) }}>
      {confirm && <><h3 id="settings-confirm-title">{tr(titles[confirm])}</h3>{(confirm === 'model' || confirm === 'audio-model') && <strong>{confirm === 'model' ? name : AUDIO_MODELS.find(model => model.id === audioModelId)?.name}</strong>}<p>{tr(descriptions[confirm])}</p><div><button type="button" className="secondary-button" disabled={working} onClick={() => setConfirm(null)}>{tr('Revenir')}</button><button type="button" className="settings-danger-button" disabled={working} onClick={async () => { setWorking(true); try { await onAction(confirm); setConfirm(null) } catch (cause) { setError(String((cause as Error).message ?? cause)); setConfirm(null) } finally { setWorking(false) } }}>{working ? <Loader2 size={15} className="animate-spin" /> : null}{tr(confirm === 'reset' ? 'Réinitialiser' : 'Supprimer')}</button></div></>}
    </dialog>
  </>
}
