import type { TextToSpeech } from '@mediapipe/tasks-audio'

export const POCKET_SPEECH_CACHE = 'localai-pocket-speech-v1'
const pocketRepo = 'https://huggingface.co/litert-community/pocket-tts/resolve/main/'
const voices = {
  fr: { file: 'pocket_tts_fr_int8.litertlm', voice: 'estelle' },
  en: { file: 'pocket_tts_en_int8.litertlm', voice: 'alba' },
} as const

async function loadSpeechEngine(url: string, voice: string, signal: AbortSignal) {
  const { TextToSpeech } = await import('@mediapipe/tasks-audio')
  const cache = await caches.open(POCKET_SPEECH_CACHE)
  const cached = await cache.match(url)
  const response = cached ?? await fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error('Téléchargement de la voix impossible.')
  if (!cached) {
    await cache.put(url, response)
  }
  const model = cached ?? await cache.match(url)
  if (!model?.body) throw new Error('Fichier de voix indisponible.')
  const body = model.body
  return navigator.locks.request('localai-speech-initialization', { signal }, () => {
    signal.throwIfAborted()
    return TextToSpeech.createFromOptions({
      wasmLoaderPath: new URL('../../node_modules/@mediapipe/tasks-audio/wasm/audio_wasm_internal.js', import.meta.url).href,
      wasmBinaryPath: new URL('../../node_modules/@mediapipe/tasks-audio/wasm/audio_wasm_internal.wasm', import.meta.url).href,
    }, {
      baseOptions: { modelAssetBuffer: body.getReader(), delegate: 'CPU' },
      defaultVoiceId: voice,
    })
  })
}

let current: TextToSpeech | null = null
let controller: AbortController | null = null
let context: AudioContext | null = null

export function stopNeuralSpeech() {
  controller?.abort()
  controller = null
  current?.cancel()
  const activeContext = context
  context = null
  if (activeContext) void activeContext.close().catch(() => {})
}

export function supportsNeuralSpeech(language: string): language is 'fr' | 'en' {
  return language === 'fr' || language === 'en'
}

export async function speakNeural(text: string, language: 'fr' | 'en', onStart?: () => void) {
  const task = new AbortController()
  controller = task
  const playback = new AudioContext()
  context = playback
  const started = playback.resume()
  void started.catch(() => {})
  let engine: TextToSpeech | null = null
  try {
    const voice = voices[language]
    engine = await loadSpeechEngine(pocketRepo + voice.file, voice.voice, task.signal)
    if (task.signal.aborted) return
    current = engine
    await started
    const stream = await engine.synthesizeStream(text, undefined, true)
    let next = 0
    let hasAudio = false
    for await (const chunk of stream) {
      if (task.signal.aborted) return
      if (!chunk.samples.length) continue
      const buffer = playback.createBuffer(1, chunk.samples.length, chunk.sampleRateHz)
      buffer.getChannelData(0).set(chunk.samples)
      const source = playback.createBufferSource()
      source.buffer = buffer
      source.connect(playback.destination)
      const start = Math.max(next, playback.currentTime + .02)
      source.start(start)
      next = start + buffer.duration
      if (!hasAudio) onStart?.()
      hasAudio = true
    }
    while (!task.signal.aborted && playback.currentTime < next && playback.state === 'running') {
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    if (!hasAudio && !task.signal.aborted) throw new Error('La voix n’a produit aucun audio.')
  } catch (error) {
    if (!task.signal.aborted) throw error
  } finally {
    if (controller === task) controller = null
    if (current === engine) current = null
    engine?.close()
    if (context === playback) context = null
    if (playback.state !== 'closed') await playback.close().catch(() => {})
  }
}
