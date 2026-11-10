// Development-only preview: real UI, simulated inference, no model download.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { LocalMicRecorder } from '../src/utils/localAudio'
let recording = false
LocalMicRecorder.prototype.start = async function () { recording = true }
LocalMicRecorder.prototype.stop = async function () { recording = false; return new Float32Array(16000) }
LocalMicRecorder.prototype.cancel = function () { recording = false }
LocalMicRecorder.prototype.frequencyLevels = function (count = 24) { return Array.from({ length: count }, (_, i) => recording ? .15 + .7 * (Math.sin(performance.now() / 190 + i / 3) + 1) / 2 : 0) }
LocalMicRecorder.prototype.waveformLevel = function () { return recording ? .1 + .8 * (Math.sin(performance.now() / 210) + 1) / 2 : 0 }
Object.defineProperty(LocalMicRecorder.prototype, 'isRecording', { get: () => recording })
const metrics = { tokens: 42, promptTokens: 128, tokensPerSecond: 71.4, elapsedMs: 850, firstTokenMs: 140, finishReason: 'stop', droppedTurns: 0 }
if (!localStorage.getItem('localaiLanguage')) localStorage.setItem('localaiLanguage', 'fr')
const modelId = 'lfm3-text-1.7b-q8'
const scenario = new URLSearchParams(location.search)
class PreviewWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  timers: ReturnType<typeof setTimeout>[] = []
  audio: boolean
  failOnce = scenario.has('fail')
  constructor(url: URL) { this.audio = String(url).includes('audioWorker') }
  postMessage(message: { type: string; requestId?: number; modelId?: string }) {
    const emit = (data: unknown, delay = 0) => this.timers.push(setTimeout(() => this.onmessage?.({ data }), delay))
    if (message.type === 'check') emit(this.audio ? { type: 'asr-cache', cached: scenario.has('cached') } : { type: 'cache-status', cachedMap: scenario.has('cached') ? { [modelId]: true, 'qwen3-text-1.7b-q8': true, 'qwen3-text-0.6b-q8': true } : { [modelId]: !scenario.has('setup') }, loadedModelId: scenario.has('setup') || scenario.has('cached') ? null : modelId, webgpu: true })
    if (message.type === 'load') {
      const stepMs = scenario.has('slow') ? 4000 : 1000
      if (this.failOnce) {
        this.failOnce = false
        emit(this.audio ? { type: 'asr-error', message: 'Connexion interrompue. Réessayez.' } : { type: 'error', scope: 'load', message: 'Connexion interrompue. Réessayez.' }, 500)
        return
      }
      for (const [i, progress] of [0, .25, .6, .9, .95].entries()) {
        emit(this.audio ? { type: 'asr-progress', progress, text: 'Téléchargement de Whisper' } : { type: 'load-progress', modelId: message.modelId, phase: progress === .95 ? 'warmup' : 'download', progress }, i * stepMs)
      }
      emit(this.audio ? { type: 'asr-ready' } : { type: 'ready', modelId: message.modelId }, 6.5 * stepMs)
    }
    if (message.type === 'generate') {
      emit({ type: 'text', requestId: message.requestId, text: '<think>Vérification de la réflexion repliée par défaut.' }, 500)
      const text = '<think>Vérification de la réflexion repliée par défaut.</think>Bonjour ! Comment puis-je vous aider ?'
      emit({ type: 'text', requestId: message.requestId, text }, 15000)
      emit({ type: 'done', requestId: message.requestId, text, metrics }, 15020)
    }
    if (message.type === 'interrupt') { this.terminate(); emit({ type: 'done', requestId: message.requestId, text: '' }) }
    if (message.type === 'transcribe') { emit({ type: 'asr-progress', progress: 1, text: 'Transcription vocale locale en cours…' }); emit({ type: 'asr-result', source: 'mic', text: 'Bonjour, ceci est une dictée de test.' }, 8000) }
  }
  terminate() { this.timers.forEach(clearTimeout); this.timers = [] }
}
Object.defineProperty(window, 'Worker', { value: PreviewWorker })
if (!localStorage.getItem('localaiPreviewSeeded')) { localStorage.setItem('chatHistory', JSON.stringify([{
  id: 'visual-fixture', title: 'Aperçu : réflexion et citations', timestamp: Date.now(), modelId,
  messages: [
    { role: 'user', content: 'Quels conseils pour commencer ?', sentAt: Date.now(), webSources: [{ index: 1, title: 'Conseils pour entreprendre', url: 'https://www.bdc.ca/fr/articles-outils', domain: 'bdc.ca', snippet: 'Exemple de source de test.' }] },
    { role: 'assistant', content: '<think>Texte de test, visible uniquement après un clic.</think>Commencez par préciser votre idée, puis échangez avec vos futurs clients (source [1]).', sentAt: Date.now(), metrics },
  ],
}, { id: 'preview-pinned', title: 'Mon espace de travail', timestamp: Date.now() - 3000, pinned: true, modelId, messages: [{ role: 'user', content: 'Bonjour', sentAt: Date.now() }, { role: 'assistant', content: 'Bonjour. Que souhaitez-vous explorer ?', sentAt: Date.now(), metrics }] },
{ id: 'preview-notes', title: 'Quelques idées à approfondir', timestamp: Date.now() - 86400000, modelId, messages: [] }]))
localStorage.setItem('localaiPreviewSeeded', '1') }
const { default: App } = await import('../src/App')
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
