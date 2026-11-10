import { tr } from '../utils/i18n'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, Loader2 } from 'lucide-react'

export function ModelSetupDialog({ open, checking, busy, progress, phase, name, size, cached, error, unavailable, optional, onDownload, onCancel, onImport, onSettings, isVision, choices, selectedId, recommendedId, onChoose }: {
  open: boolean; checking: boolean; busy: boolean; progress: number; phase: 'download' | 'import' | 'warmup'
  name: string; size: string; cached: boolean; error: string | null; unavailable: boolean
  optional: boolean; onDownload: () => void; onCancel: () => void
  onImport?: (file: File) => void
  onSettings?: () => void; isVision?: boolean
  choices?: { id: string; name: string; sizeLabel: string; description: string }[]
  selectedId?: string; recommendedId?: string; onChoose?: (id: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [showChoices, setShowChoices] = useState(false)
  useEffect(() => {
    const dialog = ref.current
    dialog?.setAttribute('closedby', optional && !busy ? 'closerequest' : 'none')
    const cancel = (event: Event) => {
      event.preventDefault()
      if (optional && !busy) onCancel()
    }
    dialog?.addEventListener('cancel', cancel)
    if (open && !dialog?.open) dialog?.showModal()
    else if (!open && dialog?.open) dialog.close()
    return () => dialog?.removeEventListener('cancel', cancel)
  }, [open, optional, busy, onCancel])
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100)
  const operation = phase === 'download' ? 'Téléchargement de' : phase === 'import' ? 'Importation de' : 'Chargement de'
  return <dialog ref={ref} className="model-setup-dialog" aria-labelledby="model-setup-title"
    onClose={() => { if (open && (!optional || busy)) ref.current?.showModal() }}
    onCancel={(event) => { event.preventDefault(); if (optional && !busy) onCancel() }}>
    {busy ? <div className="model-loading">
      <div className="model-loading-ring" role="progressbar" aria-label={`${tr(operation)} ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="model-loading-track" cx="50" cy="50" r="43" /><circle className="model-loading-fill" cx="50" cy="50" r="43" strokeDasharray="270.2" strokeDashoffset={270.2 * (1 - percent / 100)} /></svg>
        <span>{percent}<small>%</small></span>
      </div>
      <h2 id="model-setup-title">{`${tr(operation)} ${name}`}</h2>
    </div> : <>
      <div className="setup-symbol"><Download size={24} strokeWidth={1.5} /></div>
      <h2 id="model-setup-title">{optional ? isVision ? tr("Activer les images") : tr("Activer le modèle") : tr("Votre IA, sur cet appareil")}</h2>
      <p>{checking ? tr("Vérification des modèles…") : cached ? `${name} ${tr('est disponible sur cet appareil.')}` : `${name} · ${size}`}<br />{!checking && (optional ? isVision ? tr("Un téléchargement pour analyser vos images.") : tr("Téléchargez le modèle pour commencer.") : tr("Téléchargez le modèle pour commencer."))}</p>
      {error && <p className="setup-error" role="alert">{error}</p>}
      {unavailable && <p className="setup-error" role="alert">{tr("Activez l’accélération graphique de Chrome pour utiliser Locaya.")}</p>}
      <div className="setup-action-group">
        <button type="button" className="setup-download primary-action" disabled={checking || unavailable} onClick={onDownload}>
          {checking ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
          {checking ? tr("Vérification…") : `${cached ? tr('Charger') : tr('Télécharger')} ${name}`}
        </button>
        {!optional && !isVision && choices && choices.length > 1 && <button type="button" className="setup-choice-trigger primary-action" disabled={checking || unavailable} aria-label={tr('Choisir un autre modèle')} aria-expanded={showChoices} onClick={() => setShowChoices(value => !value)}><ChevronDown size={17} /></button>}
        {showChoices && <div className="setup-choice-menu" role="menu">{choices?.map(choice => <button type="button" role="menuitemradio" aria-checked={choice.id === selectedId} key={choice.id} onClick={() => { setShowChoices(false); onChoose?.(choice.id) }}><strong>{choice.name}{choice.id === recommendedId && <em>{tr('Recommandé pour cet appareil')}</em>}</strong><span>{choice.sizeLabel} · {tr(choice.description)}</span></button>)}</div>}
      </div>
      {onImport && <>
        <input ref={fileRef} type="file" accept=".gguf" hidden aria-label={tr('Choisir un fichier GGUF')} onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) onImport(file)
          event.currentTarget.value = ''
        }} />
        <button type="button" className="setup-cancel" disabled={checking || unavailable} onClick={() => fileRef.current?.click()}>{tr('Importer mon fichier GGUF')}</button>
      </>}
      {optional && <button type="button" className="setup-cancel" onClick={onCancel}>{tr("Plus tard")}</button>}
      {onSettings && <button type="button" className="setup-cancel" onClick={onSettings}>{tr("Paramètres")}</button>}
    </>}
  </dialog>
}
