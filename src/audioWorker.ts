// Web Worker dédié à la transcription audio 100 % locale (Dictée micro & Audio d'onglet)
// Exécute le modèle Whisper sélectionné (quantifié) via le pipeline `automatic-speech-recognition`,
// mis en cache dans le CacheStorage du navigateur pour un fonctionnement 100 % hors-ligne.

import { env, pipeline, ModelRegistry, Tensor } from '@huggingface/transformers'
import { audioModelId, DEFAULT_AUDIO_MODEL, importedAudioDtype, PARAKEET_MODEL_ID, type AudioDevice, type DictationBackend, type DictationLanguage } from './utils/audioModels'
import { hasImportedAudioModel } from './utils/audioModelImport'
import { detectSpokenLanguage } from './utils/whisperLanguage'
import { ModelLoadProgress } from './utils/modelLoadProgress'
import { omitWindowsWebGPUPowerPreference } from './utils/webgpuAdapter'
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
onnxEnv.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1)) : 1
if (onnxEnv.webgpu) delete onnxEnv.webgpu.powerPreference
omitWindowsWebGPUPowerPreference()

export type AudioWorkerRequest = { type: 'check' | 'load'; modelId?: string; backend?: DictationBackend; cachedOnly?: boolean } | {
  type: 'transcribe'
  audio: Float32Array
  modelId?: string
  source: 'mic' | 'tab'
  dictationLanguage?: DictationLanguage
}

export type AudioMetrics = { elapsedMs: number; audioSeconds: number; device: AudioDevice }

export type AudioWorkerResponse =
  | { type: 'asr-cache'; cached: boolean; installed: boolean; device: AudioDevice }
  | { type: 'asr-ready'; device: AudioDevice }
  | { type: 'asr-progress'; progress: number; text: string }
  | ({ type: 'asr-result'; text: string; source: 'mic' | 'tab' } & AudioMetrics)
  | { type: 'asr-error'; message: string; source?: 'mic' | 'tab' }

const post = (msg: AudioWorkerResponse) => (self as unknown as Worker).postMessage(msg)

let transcriberPromise: Promise<any> | null = null
let transcriberReady = false
let activeModelId: string = DEFAULT_AUDIO_MODEL
let activeDevice: AudioDevice = 'wasm'
let gpuFailed = false
const modelOptions = (device: AudioDevice) => ({
  device,
  dtype: device === 'webgpu' ? 'fp32' as const : { encoder_model: 'q8', decoder_model_merged: 'q8' } as const,
})

async function chooseDevice(modelId: string, preference: DictationBackend = 'wasm'): Promise<AudioDevice> {
  if (preference === 'wasm' || gpuFailed || importedAudioDtype(modelId) || modelId === PARAKEET_MODEL_ID) return 'wasm'
  if (preference === 'auto' && modelId !== DEFAULT_AUDIO_MODEL) return 'wasm'
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{
    info: { isFallbackAdapter?: boolean; vendor?: string }; features: Set<string>
  } | null> } }).gpu
  const adapter = await gpu?.requestAdapter().catch(() => null)
  if (!adapter || adapter.info?.isFallbackAdapter) return 'wasm'
  // Only auto-enable on hardware close to the tested configuration. The
  // shader-f16 feature is a capability signal, not required by FP32 weights.
  if (preference === 'auto' && (adapter.info?.vendor !== 'nvidia' || !adapter.features.has('shader-f16'))) return 'wasm'
  return 'webgpu'
}

async function isCached(modelId: string, device: AudioDevice) {
  if (transcriberReady && activeModelId === modelId && activeDevice === device) return true
  const imported = importedAudioDtype(modelId)
  try {
    if (modelId === PARAKEET_MODEL_ID) return device === 'wasm' && await (await import('./utils/parakeetAudio')).isParakeetCached()
    return imported ? await hasImportedAudioModel(modelId, imported)
      : await ModelRegistry.is_cached(modelId, modelOptions(device))
  } catch { return false }
}

async function reportCache(modelId: string, device: AudioDevice) {
  const cached = await isCached(modelId, device)
  const installed = cached || (modelId !== PARAKEET_MODEL_ID && !importedAudioDtype(modelId) && await isCached(modelId, device === 'wasm' ? 'webgpu' : 'wasm'))
  post({ type: 'asr-cache', cached, installed, device })
}

async function getTranscriber(modelId: string, device: AudioDevice, cachedOnly = false) {
  if (activeModelId !== modelId || activeDevice !== device) {
    if (transcriberPromise) await (await transcriberPromise).dispose?.().catch(() => {})
    transcriberPromise = null
    transcriberReady = false
    activeModelId = modelId
    activeDevice = device
  }
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      if (modelId === PARAKEET_MODEL_ID) {
        post({ type: 'asr-progress', progress: 0, text: 'Chargement du modèle de dictée…' })
        const { loadParakeet } = await import('./utils/parakeetAudio')
        const model = await loadParakeet(cachedOnly, progress => post({
          type: 'asr-progress', progress, text: 'Chargement du modèle de dictée…',
        }))
        transcriberReady = true
        return model
      }
      post({ type: 'asr-progress', progress: 0, text: 'Chargement de Whisper…' })
      const importedDtype = importedAudioDtype(modelId)
      const options = modelOptions(device)
      env.allowLocalModels = !!importedDtype || cachedOnly
      env.allowRemoteModels = !importedDtype && !cachedOnly
      let files: { file: string; size?: number }[] = []
      try {
        if (!importedDtype && !cachedOnly) {
          const names = await ModelRegistry.get_model_files(modelId, options)
          const metadata = await Promise.allSettled(names.map((file) => ModelRegistry.get_file_metadata(modelId, file)))
          files = names.map((file, i) => ({ file, size: metadata[i].status === 'fulfilled' ? metadata[i].value.size : undefined }))
        }
      } catch { /* Progress remains indeterminate until initialization. */ }
      const progress = new ModelLoadProgress(files)
      const transcriber = await pipeline('automatic-speech-recognition', modelId, {
        ...options,
        ...(importedDtype ? { dtype: importedDtype } : {}),
        local_files_only: !!importedDtype || cachedOnly,
        progress_callback: importedDtype || cachedOnly ? undefined : p => {
          if ((p.status !== 'progress' && p.status !== 'done') || !p.file) return
          post({
            type: 'asr-progress',
            progress: progress.update(p),
            text: 'Chargement de Whisper',
          })
        },
      })
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

async function transcribeAudio(transcriber: any, msg: Extract<AudioWorkerRequest, {type: 'transcribe'}>) {
  if (activeModelId === PARAKEET_MODEL_ID) return transcriber.transcribe(msg.audio)
  const preferredLanguage = msg.source === 'mic' ? msg.dictationLanguage : undefined
  const language = preferredLanguage === 'fr' || preferredLanguage === 'en' ? preferredLanguage
    : await detectSpokenLanguage(transcriber, msg.audio, id => new Tensor('int64', BigInt64Array.of(BigInt(id)), [1, 1]))
  return transcriber(msg.audio, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
}

self.onmessage = async (event: MessageEvent<AudioWorkerRequest>) => {
  const msg = event.data
  const modelId = audioModelId(msg.modelId)
  if (msg.type === 'check') {
    await reportCache(modelId, await chooseDevice(modelId, msg.backend))
    return
  }
  if (msg.type === 'load') {
    const device = await chooseDevice(modelId, msg.backend)
    try {
      try { await getTranscriber(modelId, device, msg.cachedOnly) }
      catch (err) {
        if (device !== 'webgpu') throw err
        gpuFailed = true
        if (!await isCached(modelId, 'wasm')) {
          await reportCache(modelId, 'wasm')
          throw new Error('WebGPU indisponible pour Whisper. Téléchargez la version CPU pour continuer.')
        }
        await getTranscriber(modelId, 'wasm', true)
      }
      post({ type: 'asr-ready', device: activeDevice })
    }
    catch (err: any) { post({ type: 'asr-error', message: String(err?.message ?? err) }) }
    return
  }
  if (msg.type !== 'transcribe') return

  try {
    if (!transcriberReady || !transcriberPromise || activeModelId !== modelId) throw new Error('Téléchargez et préparez le modèle avant de commencer la dictée.')
    const transcriber = await transcriberPromise
    post({ type: 'asr-progress', progress: 1, text: 'Transcription vocale locale en cours…' })

    const start = performance.now()
    let output
    try { output = await transcribeAudio(transcriber, msg) }
    catch (err) {
      if (activeDevice !== 'webgpu') throw err
      gpuFailed = true
      transcriberReady = false
      await reportCache(modelId, 'wasm')
      if (!await isCached(modelId, 'wasm')) throw new Error('WebGPU indisponible pour Whisper. Téléchargez la version CPU pour continuer.')
      const fallback = await getTranscriber(modelId, 'wasm', true)
      output = await transcribeAudio(fallback, msg)
    }

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
      elapsedMs: performance.now() - start,
      audioSeconds: msg.audio.length / 16000,
      device: activeDevice,
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
