import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, Globe2, Loader2, MessageSquare, Mic, RotateCcw, SlidersHorizontal, Trash2, Upload, Volume2 } from 'lucide-react'
import { normalizeModelSettings, settingsForModel, type ImportedModel, type ModelSettings } from '../utils/modelSettings'
import { getModelSpec } from '../llm-protocol'
import { AUDIO_MODELS, importedAudioDtype, PARAKEET_MODEL_ID, type AudioDevice, type DictationBackend, type DictationLanguage, type ImportedAudioModel } from '../utils/audioModels'
import type { AudioMetrics } from '../audioWorker'
import { cachedGguf } from '../utils/ggufStore'
import { cachedAudioBytes } from '../utils/modelCache'
import { MicrophoneSettings } from './MicrophoneSettings'
import { tr, type InterfaceLanguage } from '../utils/i18n'
import { WEB_PROVIDERS, type WebProvider, type WebSettings } from '../utils/webProviders'

export type SettingsAction = 'reset' | 'models' | 'conversations' | 'model' | 'audio-model'

function ModelFootprint({ id, installed, active, audio = false }: {
  id: string; installed: boolean; active: boolean; audio?: boolean
}) {
  const [size, setSize] = useState<number | null>(null)
  useEffect(() => {
    setSize(null)
    if (!active || !installed) return
    let current = true
    const read = audio ? cachedAudioBytes(id) : cachedGguf(id).then(file => file?.size ?? null)
    void read.then(bytes => { if (current) setSize(bytes) }).catch(() => {})
    return () => { current = false }
  }, [id, installed, active, audio])
  if (!installed) return <small className="settings-install-status">{tr('À télécharger')}</small>
  const formatted = size && new Intl.NumberFormat(undefined, {
    style: 'unit', unit: size >= 1e9 ? 'gigabyte' : 'megabyte', maximumFractionDigits: 1,
  }).format(size / (size >= 1e9 ? 1e9 : 1e6))
  return <small className="settings-install-status">{tr('Installé sur cet appareil')}{formatted ? ` · ${formatted}` : ''}</small>
}

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
    local: 'Locaya interroge les moteurs de recherche et lit les pages directement depuis le navigateur.',
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

export function SettingsDialog({ open, onClose, language, onLanguage, models, selectedModelId, settings, onSave, onSelect, onImport, busy, audioModelId, onAudioModel, onAction, web, onWeb, textModelInstalled, audioModelInstalled, importedAudioModels, onImportAudio, dictationLanguage, onDictationLanguage, micDeviceId, onMicDevice, audioMetrics, dictationBackend, onDictationBackend, audioDevice }: {
  open: boolean; onClose: () => void; language: InterfaceLanguage; onLanguage: (language: InterfaceLanguage) => void
  models: ImportedModel[]; selectedModelId: string; settings: Record<string, ModelSettings>; busy: boolean
  onSave: (id: string, settings: ModelSettings) => void; onSelect: (id: string) => void; onImport: (file: File) => void
  audioModelId: string; onAudioModel: (id: string) => void; onAction: (action: SettingsAction) => Promise<void>
  web: WebSettings; onWeb: (settings: WebSettings) => void
  textModelInstalled: boolean; audioModelInstalled: boolean
  importedAudioModels: ImportedAudioModel[]; onImportAudio: (files: File[]) => Promise<void>
  dictationLanguage: DictationLanguage; onDictationLanguage: (language: DictationLanguage) => void
  micDeviceId: string; onMicDevice: (id: string) => void; audioMetrics: AudioMetrics | null
  dictationBackend: DictationBackend; onDictationBackend: (backend: DictationBackend) => void; audioDevice: AudioDevice | null
}) {
  const dialog = useRef<HTMLDialogElement>(null), confirmation = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null)
  const audioFolderInput = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<SettingsAction | null>(null)
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null)
  const [chatModelExpanded, setChatModelExpanded] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)
  const [speechVoice, setSpeechVoice] = useState(() => localStorage.getItem('localaiSpeechVoice') ?? 'system')
  const [developerOptions, setDeveloperOptions] = useState(() => localStorage.getItem('localaiDeveloperOptions') === 'true')
  const modelId = selectedModelId, draft = settingsForModel(modelId, settings[modelId])
  const name = models.find(model => model.id === modelId)?.name ?? 'LFM3'
  const audioName = [...AUDIO_MODELS, ...importedAudioModels].find(model => model.id === audioModelId)?.name
  const importedAudio = !!importedAudioDtype(audioModelId)
  const parakeet = audioModelId === PARAKEET_MODEL_ID
  const activeDevice = audioMetrics?.device ?? audioDevice
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); else if (!open) dialog.current?.close() }, [open])
  useEffect(() => { if (confirm && !confirmation.current?.open) confirmation.current?.showModal(); else if (!confirm) confirmation.current?.close() }, [confirm])
  const change = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) => onSave(modelId, normalizeModelSettings({ ...draft, [key]: value }))
  const number = (key: keyof ModelSettings, label: string, min: number, max: number, step = 1, help?: string) => <NumberSetting key={`${modelId}-${key}`} value={draft[key] as number} label={label} min={min} max={max} step={step} help={help} onChange={value => change(key, value)} />
  const danger = (action: SettingsAction, label: string, Icon = Trash2) => <button type="button" className="settings-danger-button" disabled={busy || working} onClick={() => { setError(null); setConfirm(action) }}><Icon size={15} />{tr(label)}</button>
  const titles = { reset: 'Réinitialiser tous les paramètres ?', models: 'Supprimer tous les modèles ?', conversations: 'Supprimer toutes les conversations ?', model: 'Supprimer ce modèle ?', 'audio-model': 'Supprimer ce modèle de dictée ?' }
  const descriptions = {
    reset: 'Les réglages reviendront aux valeurs initiales et les clés API seront effacées. Les modèles téléchargés et les conversations seront conservés.',
    models: 'Le cache de tous les modèles de Locaya sera supprimé et les moteurs arrêtés. Il faudra télécharger ou importer les modèles à nouveau.',
    conversations: 'Toutes les conversations de cet appareil seront supprimées définitivement. Cette action est irréversible.',
    model: 'Les fichiers de ce modèle seront supprimés de cet appareil. Un modèle importé sera aussi retiré de la liste.',
    'audio-model': 'Les fichiers de ce modèle de dictée seront supprimés. Vous pourrez le télécharger à nouveau.',
  }
  return <>
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); if (!working) onClose() }} onClose={() => { if (open) onClose() }}>
      <header className="settings-heading"><div className="settings-heading-inner"><button type="button" className="header-icon" onClick={onClose} disabled={working} aria-label={tr('Retour à la conversation')}><ArrowLeft size={20} /></button><div><h2 id="settings-title">{tr('Paramètres')}</h2><small><Check size={12} aria-hidden="true" />{tr('Modifications appliquées automatiquement.')}</small></div></div></header>
      <div className="settings-body">
        <section className="settings-group" aria-labelledby="settings-general-title">
          <h3 className="settings-group-title" id="settings-general-title">{tr('Général')}</h3>
          <label className="setting-field setting-language"><span><Globe2 size={17} aria-hidden="true" />{tr('Langue de l’interface')}</span><select value={language} onChange={event => onLanguage(event.currentTarget.value as InterfaceLanguage)}><option value="fr">Français</option><option value="en">English</option></select></label>
        </section>
        <section className="settings-group" aria-labelledby="settings-models-title">
        <div className="settings-group-heading"><h3 className="settings-group-title" id="settings-models-title">{tr('Vos modèles')}</h3><p>{tr('Choisissez les modèles qui vous correspondent.')}</p></div>
        <details className="settings-model-card" onToggle={event => setChatModelExpanded(event.currentTarget.open)}>
          <summary><span className="settings-card-icon"><MessageSquare size={20} aria-hidden="true" /></span><span className="settings-card-label">{tr('Modèle de conversation')}<small>{name}</small></span><ChevronDown className="settings-chevron" size={17} aria-hidden="true" /></summary>
          <div className="settings-model-content">
          <label className="setting-field"><span>{tr('Modèle sélectionné')}<ModelFootprint id={modelId} installed={textModelInstalled} active={open && chatModelExpanded} /></span><select value={modelId} disabled={busy || working} onChange={event => onSelect(event.currentTarget.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          <input ref={fileInput} type="file" accept=".gguf" hidden aria-label={tr('Importer mon fichier GGUF')} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) { onImport(file); onClose() } event.currentTarget.value = '' }} />
          <button type="button" className="import-model-button" disabled={busy || working} onClick={() => fileInput.current?.click()}><Upload size={15} />{tr('Importer mon fichier GGUF')}</button><small>{tr('Fichier local uniquement. Le moteur doit prendre en charge son architecture.')}</small>
        {developerOptions && <fieldset className="settings-model-fields" disabled={busy || working}>
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
          {getModelSpec(modelId).supportsThinking !== false && <details className="settings-section"><summary>{tr('Réflexion')}</summary><label className="setting-check"><input type="checkbox" checked={draft.reasoningBudget === -1} onChange={event => change('reasoningBudget', event.currentTarget.checked ? -1 : Math.min(1024, draft.maxOutputTokens - 1))} />{tr('Sans limite spécifique')}</label>{draft.reasoningBudget !== -1 && number('reasoningBudget', 'Tokens de réflexion maximum', 0, draft.maxOutputTokens - 1)}<small>{tr('Le budget de sortie inclut la réflexion et la réponse finale.')}</small></details>}
          <details className="settings-section"><summary>{tr('Avancé')}</summary><div className="settings-grid">{number('threads', 'Threads CPU', 1, 64)}{number('batchSize', 'Taille de batch', 16, 2048)}{number('microBatchSize', 'Microbatch', 16, Math.min(512, draft.batchSize))}</div><label className="setting-check"><input type="checkbox" checked={draft.flashAttention} onChange={event => change('flashAttention', event.currentTarget.checked)} />{tr('Flash Attention')}</label><label className="setting-field"><span>{tr('Séquences d’arrêt')}</span><textarea rows={2} value={draft.stopSequences} placeholder={tr('Une séquence par ligne')} onChange={event => change('stopSequences', event.currentTarget.value)} /></label></details>
        </fieldset>}
          {textModelInstalled && <div className="settings-model-delete">{danger('model', 'Supprimer ce modèle')}</div>}
          </div>
        </details>
        <details className="settings-model-card" onToggle={event => setAudioExpanded(event.currentTarget.open)}>
          <summary><span className="settings-card-icon"><Mic size={20} aria-hidden="true" /></span><span className="settings-card-label">{tr('Dictée vocale')}<small>{audioName}</small></span><ChevronDown className="settings-chevron" size={17} aria-hidden="true" /></summary>
          <div className="settings-model-content">
            <label className="setting-field">
              <span>{tr('Modèle sélectionné')}<ModelFootprint id={audioModelId} installed={audioModelInstalled} active={open && audioExpanded} audio /></span>
              <select value={audioModelId} disabled={busy || working} onChange={event => onAudioModel(event.currentTarget.value)}>
                {AUDIO_MODELS.map(model => <option key={model.id} value={model.id}>{model.name} — {tr(model.description)}</option>)}
                {importedAudioModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </label>
            <label className="setting-field">
              <span>{tr('Langue de dictée')}</span>
              <select value={parakeet ? 'auto' : dictationLanguage} disabled={busy || working || parakeet} onChange={event => onDictationLanguage(event.currentTarget.value as DictationLanguage)}>
                <option value="auto">{tr('Détection automatique')}</option>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
              <small>{tr('Choisissez une langue pour faciliter la reconnaissance des phrases courtes.')}</small>
            </label>
            <label className="setting-field">
              <span>{tr('Accélération de la dictée')}</span>
              <select value={importedAudio || parakeet ? 'wasm' : dictationBackend} disabled={busy || working || importedAudio || parakeet}
                onChange={event => onDictationBackend(event.currentTarget.value as DictationBackend)}>
                <option value="auto">{tr('Automatique (recommandé)')}</option>
                <option value="wasm">{tr('Processeur (CPU)')}</option>
                <option value="webgpu">{tr('Carte graphique (WebGPU)')}</option>
              </select>
              <small>{tr(parakeet ? 'Parakeet utilise le processeur et détecte la langue automatiquement.' : importedAudio ? 'Les modèles de dictée importés utilisent le processeur.'
                : 'Le mode automatique utilise WebGPU pour Whisper Base sur les appareils compatibles. Le mode GPU utilise des fichiers plus volumineux.')}</small>
              {dictationBackend === 'webgpu' && !importedAudio && !parakeet && activeDevice === 'wasm' &&
                <small>{tr('Le processeur est utilisé sur cette configuration.')}</small>}
            </label>
            {open && audioExpanded && !confirm && <MicrophoneSettings deviceId={micDeviceId} onChange={onMicDevice} disabled={busy || working} />}
            {developerOptions && <div className="settings-audio-diagnostics">
              <h4>{tr('Diagnostic de dictée')}</h4>
              <dl>
                <div><dt>{tr('Moteur de dictée')}</dt><dd>ONNX Runtime{activeDevice && (activeDevice === 'webgpu' ? ' · GPU (WebGPU)' : ' · CPU (WASM)')}</dd></div>
                {audioMetrics && <>
                  <div><dt>{tr('Dernière transcription')}</dt><dd>{(audioMetrics.elapsedMs / 1000).toLocaleString(language, { maximumFractionDigits: 2 })} s</dd></div>
                  <div><dt>{tr('Durée de l’enregistrement')}</dt><dd>{audioMetrics.audioSeconds.toLocaleString(language, { maximumFractionDigits: 2 })} s</dd></div>
                </>}
              </dl>
              {!audioMetrics && <small>{tr('Les mesures apparaissent après une dictée.')}</small>}
            </div>}
            <input ref={audioFolderInput} type="file" hidden onChange={async event => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              if (!files.length) return
              setError(null)
              setWorking(true)
              try { await onImportAudio(files) }
              catch (cause) { setError(tr((cause as Error).message)) }
              finally { setWorking(false) }
            }} />
            <button type="button" className="import-model-button" disabled={busy || working} onClick={() => {
              const input = audioFolderInput.current
              input?.setAttribute('webkitdirectory', '')
              input?.click()
            }}>
              {working && !confirm ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {tr(working && !confirm ? 'Importation du modèle de dictée…' : 'Importer mon modèle de dictée')}
            </button>
            <small>{tr('Dossier Whisper ONNX multilingue, avec les fichiers JSON et le dossier onnx/.')}</small>
            {audioModelInstalled && <div className="settings-model-delete">{danger('audio-model', 'Supprimer ce modèle de dictée')}</div>}
          </div>
        </details>
        <details className="settings-model-card">
          <summary><span className="settings-card-icon"><Volume2 size={20} aria-hidden="true" /></span><span className="settings-card-label">{tr('Lecture des réponses')}<small>{speechVoice === 'pocket' ? 'Pocket TTS' : tr('Voix du système')}</small></span><ChevronDown className="settings-chevron" size={17} aria-hidden="true" /></summary>
          <div className="settings-model-content">
            <label className="setting-field">
              <span>{tr('Voix de lecture')}</span>
              <select value={speechVoice} onChange={event => {
                setSpeechVoice(event.currentTarget.value)
                localStorage.setItem('localaiSpeechVoice', event.currentTarget.value)
              }}>
                <option value="system">{tr('Voix du système')}</option>
                <option value="pocket">Pocket TTS · Français / English</option>
              </select>
              <small>{tr('Pocket TTS télécharge la voix de la langue à la première lecture et fonctionne ensuite hors ligne.')}</small>
            </label>
          </div>
        </details>
        </section>
        <section className="settings-group settings-advanced-group" aria-labelledby="settings-advanced-title">
          <h3 className="settings-group-title" id="settings-advanced-title">{tr('Personnalisation avancée')}</h3>
          <label className="settings-developer-toggle"><SlidersHorizontal size={18} aria-hidden="true" /><span>{tr('Options développeur')}<small>{tr('Affiche les réglages détaillés des modèles et de la recherche web.')}</small></span><input type="checkbox" role="switch" checked={developerOptions} onChange={event => { const enabled = event.currentTarget.checked; setDeveloperOptions(enabled); localStorage.setItem('localaiDeveloperOptions', String(enabled)) }} /></label>
          {developerOptions && <WebSettingsSection settings={web} onChange={onWeb} />}
        </section>
        <section className="settings-group settings-data-section"><div className="settings-group-heading"><h3 className="settings-group-title">{tr('Données sur cet appareil')}</h3><p>{tr('Gardez le contrôle de vos données locales.')}</p></div><div className="settings-data-actions">{danger('reset', 'Réinitialiser tous les paramètres', RotateCcw)}{danger('models', 'Supprimer tous les modèles')}{danger('conversations', 'Supprimer toutes les conversations')}</div><small>{tr('Une confirmation vous sera demandée.')}</small></section>
        {error && <p role="alert" className="settings-error">{error}</p>}
      </div>
    </dialog>
    <dialog ref={confirmation} className="settings-confirm-dialog" aria-labelledby="settings-confirm-title" onCancel={event => { event.preventDefault(); if (!working) setConfirm(null) }}>
      {confirm && <><h3 id="settings-confirm-title">{tr(titles[confirm])}</h3>{(confirm === 'model' || confirm === 'audio-model') && <strong>{confirm === 'model' ? name : audioName}</strong>}<p>{tr(descriptions[confirm])}</p><div><button type="button" className="secondary-button" disabled={working} onClick={() => setConfirm(null)}>{tr('Revenir')}</button><button type="button" className="settings-danger-button" disabled={working} onClick={async () => { setWorking(true); try { await onAction(confirm); if (confirm === 'reset') { setDeveloperOptions(false); setSpeechVoice('system') }; setConfirm(null) } catch (cause) { setError(String((cause as Error).message ?? cause)); setConfirm(null) } finally { setWorking(false) } }}>{working ? <Loader2 size={15} className="animate-spin" /> : null}{tr(confirm === 'reset' ? 'Réinitialiser' : 'Supprimer')}</button></div></>}
    </dialog>
  </>
}
