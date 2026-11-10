// Manual integration check: production worker, real ONNX, public HF speech samples.
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { decodeBlobTo16kHzPCM } from '../src/utils/localAudio'
import type { AudioWorkerResponse } from '../src/audioWorker'
function AudioEvaluation() {
  const worker = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('Prêt'), [result, setResult] = useState('')
  const modelId = 'onnx-community/whisper-tiny'
  const start = () => {
    const instance = new Worker(new URL('../src/audioWorker.ts', import.meta.url), { type: 'module' })
    instance.onmessage = ({ data }: MessageEvent<AudioWorkerResponse>) => {
      if (worker.current !== instance) return
      if (data.type === 'asr-ready') { setReady(true); setBusy(false); setStatus('Whisper Tiny prêt') }
      if (data.type === 'asr-progress') setStatus(`${data.text} ${Math.round(data.progress * 100)} %`)
      if (data.type === 'asr-result') { setResult(data.text); setBusy(false); setStatus('Transcription terminée') }
      if (data.type === 'asr-error') { setResult(data.message); setBusy(false); setStatus('Erreur') }
    }
    instance.onerror = event => { setResult(event.message); setBusy(false); setStatus('Erreur du moteur') }
    worker.current = instance
    setBusy(true)
    instance.postMessage({ type: 'load', modelId })
  }
  const transcribe = async (file: string) => {
    setBusy(true); setStatus('Lecture du fichier audio'); setResult('')
    try {
      const response = await fetch(`https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/${file}`)
      if (!response.ok) throw Error(`HTTP ${response.status}`)
      const audio = await decodeBlobTo16kHzPCM(await response.blob())
      worker.current?.postMessage({ type: 'transcribe', modelId, source: 'mic', audio }, [audio.buffer])
    } catch (error) { setResult(String(error)); setBusy(false) }
  }
  return <main style={{fontFamily:'system-ui',maxWidth:700,margin:'40px auto',padding:24}}><h1>Test de dictée réelle</h1><p>Whisper Tiny q8 · moteur de production · détection acoustique · aucune langue imposée</p><button disabled={busy || ready} onClick={start}>Télécharger et charger Whisper Tiny</button> <button disabled={!ready || busy} onClick={() => void transcribe('jfk.wav')}>Tester l’anglais</button> <button disabled={!ready || busy} onClick={() => void transcribe('french-audio.mp3')}>Tester le français</button><p role="status">{status}</p><pre style={{whiteSpace:'pre-wrap'}}>{result}</pre></main>
}
createRoot(document.getElementById('root')!).render(<AudioEvaluation />)
