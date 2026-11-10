import { tr } from '../utils/i18n'
import { useEffect, useRef } from 'react'
import { Download, Loader2 } from 'lucide-react'

export function ModelSetupDialog({ open, checking, busy, progress, preparing, name, size, cached, error, unavailable, optional, onDownload, onCancel, onImport, onSettings, isVision, custom }: {
  open: boolean; checking: boolean; busy: boolean; progress: number; preparing: boolean
  name: string; size: string; cached: boolean; error: string | null; unavailable: boolean
  optional: boolean; onDownload: () => void; onCancel: () => void
  onImport?: (file: File) => void
  onSettings?: () => void; isVision?: boolean; custom?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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
  return <dialog ref={ref} className="model-setup-dialog" aria-labelledby="model-setup-title"
    onClose={() => { if (open && (!optional || busy)) ref.current?.showModal() }}
    onCancel={(event) => { event.preventDefault(); if (optional && !busy) onCancel() }}>
    {busy ? <div className="model-loading">
      <div className="model-loading-ring" role="progressbar" aria-label={`${tr('Chargement de')} ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="model-loading-track" cx="50" cy="50" r="43" /><circle className="model-loading-fill" cx="50" cy="50" r="43" strokeDasharray="270.2" strokeDashoffset={270.2 * (1 - percent / 100)} /></svg>
        <span>{percent}<small>%</small></span>
      </div>
      <h2 id="model-setup-title">{preparing ? tr("Préparation du modèle") : `${tr('Chargement de')} ${name}`}</h2>
    </div> : <>
      <div className="setup-symbol"><Download size={24} strokeWidth={1.5} /></div>
      <h2 id="model-setup-title">{optional ? isVision ? tr("Activer les images") : tr("Activer le modèle") : tr("Votre IA, sur cet appareil")}</h2>
      <p>{checking ? tr("Vérification des modèles…") : cached ? `${name} ${tr('est disponible sur cet appareil.')}` : `${name} · ${size}`}<br />{!checking && (optional ? isVision ? tr("Un téléchargement pour analyser vos images.") : tr("Téléchargez le modèle pour commencer.") : tr("Téléchargez le modèle pour commencer."))}</p>
      {error && <p className="setup-error" role="alert">{error}</p>}
      {unavailable && <p className="setup-error" role="alert">{tr("Activez l’accélération graphique de Chrome pour utiliser LocalAI.")}</p>}
      <button type="button" className="setup-download primary-action" disabled={checking || unavailable} onClick={onDownload}>
        {checking ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
        {checking ? tr("Vérification…") : `${cached ? tr('Charger') : tr('Télécharger')} ${name}`}
      </button>
      {onImport && <>
        <input ref={fileRef} type="file" accept=".gguf" hidden aria-label={tr(custom ? 'Choisir un fichier GGUF' : "Choisir le fichier LFM3 Q8 GGUF")} onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) onImport(file)
          event.currentTarget.value = ''
        }} />
        <button type="button" className="setup-cancel" disabled={checking || unavailable} onClick={() => fileRef.current?.click()}>{tr(custom ? 'Importer mon fichier GGUF' : "Importer mon fichier Q8_0.gguf")}</button>
      </>}
      {optional && <button type="button" className="setup-cancel" onClick={onCancel}>{tr("Plus tard")}</button>}
      {onSettings && <button type="button" className="setup-cancel" onClick={onSettings}>{tr("Paramètres")}</button>}
    </>}
  </dialog>
}
