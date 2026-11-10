import { env } from 'onnxruntime-web'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import ortLoader from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import { fromUrls } from 'parakeet.js'
import { PARAKEET_MODEL_ID } from './audioModels'
import { ModelLoadProgress } from './modelLoadProgress'

const sizes = {
  'encoder-model.int8.onnx': 652183999,
  'decoder_joint-model.int8.onnx': 18202004,
  'vocab.txt': 102132,
}
const files = Object.keys(sizes) as (keyof typeof sizes)[]
const modelUrl = (file: string) => `https://huggingface.co/${PARAKEET_MODEL_ID}/resolve/e5356bf/${file}`

export async function isParakeetCached() {
  if (!await caches.has('transformers-cache')) return false
  const cache = await caches.open('transformers-cache')
  return (await Promise.all(files.map(file => cache.match(modelUrl(file))))).every(Boolean)
}

export async function loadParakeet(cachedOnly: boolean, onProgress: (progress: number) => void) {
  env.wasm.wasmPaths = {
    wasm: new URL(ortWasm, location.href).href,
    mjs: new URL(ortLoader, location.href).href,
  }
  const cache = await caches.open('transformers-cache')
  const progress = new ModelLoadProgress(files.map(file => ({ file, size: sizes[file] })))
  const urls: string[] = []
  try {
    for (const file of files) {
      const url = modelUrl(file)
      let response = await cache.match(url)
      if (!response) {
        if (cachedOnly) throw new Error('Le modèle de dictée doit être téléchargé.')
        const downloaded = await fetch(url)
        if (!downloaded.ok || !downloaded.body) throw new Error(`Téléchargement de Parakeet impossible (HTTP ${downloaded.status}).`)
        let loaded = 0, lastUpdate = 0
        const body = downloaded.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            loaded += chunk.byteLength
            if (performance.now() - lastUpdate > 100) {
              onProgress(progress.update({ file, loaded, total: sizes[file] }))
              lastUpdate = performance.now()
            }
            controller.enqueue(chunk)
          },
          flush() {
            if (loaded !== sizes[file]) throw new Error('Téléchargement de Parakeet incomplet.')
          },
        }))
        await cache.put(url, new Response(body, { headers: { 'Content-Length': String(sizes[file]) } }))
        response = await cache.match(url)
      }
      if (!response) throw new Error('Fichier de dictée indisponible.')
      urls.push(URL.createObjectURL(await response.blob()))
      onProgress(progress.update({ status: 'done', file }))
    }
    const model = await fromUrls({
      encoderUrl: urls[0], decoderUrl: urls[1], tokenizerUrl: urls[2],
      filenames: { encoder: files[0], decoder: files[1] },
      backend: 'wasm', preprocessorBackend: 'js', nMels: 128, subsampling: 8,
      cpuThreads: Math.min(4, navigator.hardwareConcurrency || 1),
    })
    return {
      async transcribe(audio: Float32Array) {
        if (audio.length > 30 * 16000) {
          return model.transcribeLongAudio(audio, 16000, { chunkLengthS: 30 })
        }
        const result = await model.transcribe(audio, 16000)
        return { text: result.utterance_text }
      },
    }
  } finally {
    for (const url of urls) URL.revokeObjectURL(url)
  }
}
