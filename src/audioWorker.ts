// Web Worker dédié à la transcription audio 100 % locale (Dictée micro & Audio d'onglet)
// Exécute `onnx-community/whisper-small` (quantifié) via le pipeline `automatic-speech-recognition`,
// mis en cache dans le CacheStorage du navigateur pour un fonctionnement 100 % hors-ligne.

import { env, pipeline, ModelRegistry, Tensor } from '@huggingface/transformers'
import { audioModel, DEFAULT_AUDIO_MODEL } from './utils/audioModels'
import { detectSpokenLanguage } from './utils/whisperLanguage'
import { ModelLoadProgress } from './utils/modelLoadProgress'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'

env.allowLocalModels = false
env.useBrowserCache = true
env.useWasmCache = false

const onnxEnv = (env.backends as any).onnx
onnxEnv.wasm.wasmPaths = {
  wasm: new URL(ortWasmUrl, self.location.href).href,
  mjs: new URL(ortMjsUrl, self.location.href).href,
}
onnxEnv.wasm.numThreads = 1
if (onnxEnv.webgpu) delete onnxEnv.webgpu.powerPreference

export type AudioWorkerRequest = { type: 'check' | 'load'; modelId?: string } | {
  type: 'transcribe'
  audio: Float32Array
  modelId?: string
  source: 'mic' | 'tab'
}

export type AudioWorkerResponse =
  | { type: 'asr-cache'; cached: boolean }
  | { type: 'asr-ready' }
  | { type: 'asr-progress'; progress: number; text: string }
  | { type: 'asr-result'; text: string; source: 'mic' | 'tab' }
  | { type: 'asr-error'; message: string; source?: 'mic' | 'tab' }

const post = (msg: AudioWorkerResponse) => (self as unknown as Worker).postMessage(msg)

let transcriberPromise: Promise<any> | null = null
let transcriberReady = false
let activeModelId: string = DEFAULT_AUDIO_MODEL
const options = { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'wasm' } as const

async function getTranscriber(modelId: string) {
  if (activeModelId !== modelId) {
    if (transcriberPromise) await (await transcriberPromise).dispose()
    transcriberPromise = null; transcriberReady = false; activeModelId = modelId
  }
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      post({ type: 'asr-progress', progress: 0, text: 'Chargement de Whisper…' })
      let files: { file: string; size?: number }[] = []
      try {
        const names = await ModelRegistry.get_model_files(modelId, options)
        const metadata = await Promise.allSettled(names.map((file) => ModelRegistry.get_file_metadata(modelId, file)))
        files = names.map((file, i) => ({ file, size: metadata[i].status === 'fulfilled' ? metadata[i].value.size : undefined }))
      } catch { /* Progress remains indeterminate until initialization. */ }
      const progress = new ModelLoadProgress(files)
      const transcriber = await pipeline('automatic-speech-recognition', modelId, {
      ...options,
      progress_callback: (p: any) => {
        if (!['progress', 'done'].includes(p.status) || !p.file) return
        const ratio = progress.update(p)
        post({
          type: 'asr-progress',
          progress: ratio,
          text: 'Chargement de Whisper',
        })
      },
      } as any)
      transcriberReady = true
      return transcriber
    })().catch((err) => {
      transcriberPromise = null
      transcriberReady = false
      throw err
    })
  }
  return transcriberPromise
}

self.onmessage = async (event: MessageEvent<AudioWorkerRequest>) => {
  const msg = event.data
  const modelId = audioModel(msg.modelId).id
  if (msg.type === 'check') {
    try { post({ type: 'asr-cache', cached: (transcriberReady && activeModelId === modelId) || await ModelRegistry.is_cached(modelId, options) }) }
    catch { post({ type: 'asr-cache', cached: false }) }
    return
  }
  if (msg.type === 'load') {
    try { await getTranscriber(modelId); post({ type: 'asr-ready' }) }
    catch (err: any) { post({ type: 'asr-error', message: String(err?.message ?? err) }) }
    return
  }
  if (msg.type !== 'transcribe') return

  try {
    if (!transcriberReady || !transcriberPromise || activeModelId !== modelId) throw new Error('Téléchargez et préparez Whisper avant de commencer la dictée.')
    const transcriber = await transcriberPromise
    post({ type: 'asr-progress', progress: 1, text: 'Transcription vocale locale en cours…' })

    const language = await detectSpokenLanguage(transcriber, msg.audio, id => new Tensor('int64', BigInt64Array.of(BigInt(id)), [1, 1]))
    const output = await transcriber(msg.audio, {
      language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    })

    const rawText = Array.isArray(output)
      ? output.map((o: any) => o.text ?? '').join(' ')
      : (output?.text ?? '')

    const cleanedText = rawText
      .replace(/[\[(](?:musique|music|silence|bruit|noise|applaudissements|applause)[\])]/gi, '')
      .replace(/^(?:sous-titres[^\n.]*|merci d'avoir regard[eé][^\n.]*|thank you for watching[^\n.]*)$/gi, '')
      .replace(/\s+/g, ' ')
      .trim()

    post({
      type: 'asr-result',
      text: cleanedText,
      source: msg.source,
    })
  } catch (err: any) {
    console.error('[AudioWorker] Erreur ASR:', err)
    post({
      type: 'asr-error',
      message: String(err?.message ?? err),
      source: msg.source,
    })
  }
}
