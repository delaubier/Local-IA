import { Wllama } from './vendor/generated/wllama.js'
import { DEFAULT_MODEL_ID, VISION_MODEL_ID, LFM_MODELS, getModelSpec, type WorkerRequest, type WorkerResponse, type ChatTurn } from './llm-protocol'
import { cachedGguf, saveGguf, deleteGguf } from './utils/ggufStore'
import { WllamaStream, type WllamaChunk, type WllamaMessage } from './utils/wllamaSettings'
import { normalizeModelSettings, nativeLoadSettings, nativeSampling, type ModelSettings } from './utils/modelSettings'
import { hasUsableAnswer } from './utils/thinkingBudget'

const post = (message: WorkerResponse) => self.postMessage(message)
const hasWebGPU = () => 'gpu' in navigator
let engine: Wllama | null = null
let loadedModelId: string | null = null
let vision: Worker | null = null
let visionCached = false
let visionChecks: (() => void)[] = []
let queue: Promise<void> = Promise.resolve()
let activeRequestId: number | null = null
let latestRequestId: number | null = null
let controller: AbortController | null = null
const cancelled = new Set<number>()
let nativeError = ''
let loadSignature = ''
let knownModelIds: string[] = []

function visionWorker() {
  if (vision) return vision
  vision = new Worker(new URL('./visionWorker.ts', import.meta.url), { type: 'module' })
  const instance = vision
  vision.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    if (vision !== instance) return
    if (data.type === 'cache-status') {
      visionCached = !!data.cachedMap[VISION_MODEL_ID]
      visionChecks.splice(0).forEach(resolve => resolve())
      return
    }
    if (data.type === 'ready') { loadedModelId = VISION_MODEL_ID; visionCached = true }
    if (data.type === 'deleted') visionCached = false
    if ((data.type === 'done' || data.type === 'error') && data.requestId === activeRequestId) activeRequestId = null
    post(data)
  }
  vision.onerror = () => {
    visionChecks.splice(0).forEach(resolve => resolve())
    post({ type: 'error', scope: activeRequestId === null ? 'load' : 'generate',
      ...(activeRequestId === null ? {} : { requestId: activeRequestId }), message: 'Le moteur d’analyse des images a rencontré une erreur. Réessayez.' })
  }
  return vision
}
async function cacheStatus() {
  const builtInCache = Object.fromEntries(await Promise.all(LFM_MODELS.filter(model => model.ggufFile).map(async model => [model.id, !!await cachedGguf(model.id)])))
  const customCache = Object.fromEntries(await Promise.all(knownModelIds.filter(id => id.startsWith('custom-')).map(async id => [id, !!await cachedGguf(id)])))
  await new Promise<void>(resolve => {
    visionChecks.push(resolve)
    visionWorker().postMessage({ type: 'check' } satisfies WorkerRequest)
  })
  post({ type: 'cache-status', cachedMap: { ...builtInCache, [VISION_MODEL_ID]: visionCached, ...customCache }, loadedModelId, webgpu: hasWebGPU() })
}
async function unloadText() {
  if (engine) await engine.exit().catch(() => {})
  engine = null
  loadSignature = ''
  if (loadedModelId !== VISION_MODEL_ID) loadedModelId = null
}
async function loadText(file?: File, allowDownload = true, modelId = DEFAULT_MODEL_ID, rawSettings?: ModelSettings) {
  const settings = normalizeModelSettings(rawSettings)
  const loadingSettings = nativeLoadSettings(settings)
  const signature = JSON.stringify([modelId, loadingSettings])
  if (engine?.isModelLoaded() && !file && loadSignature === signature) return
  if (!hasWebGPU()) throw new Error('WebGPU est nécessaire. Activez l’accélération graphique de Chrome.')
  if (!crossOriginIsolated) throw new Error('Rechargez l’extension : l’isolation nécessaire au moteur wllama n’est pas active.')
  if (!('Suspending' in WebAssembly)) throw new Error('Mettez Chrome à jour pour utiliser le moteur wllama (WebAssembly JSPI).')
  await unloadText()
  if (vision) { vision.terminate(); vision = null }
  loadedModelId = null
  let blob: File | null = await cachedGguf(modelId)
  if (file || (!blob && allowDownload)) {
    const phase = file ? 'import' : 'download'
    post({ type: 'load-progress', modelId, phase, progress: 0 })
    blob = await saveGguf(file, (loaded, total) => post({ type: 'load-progress', modelId, phase, progress: loaded / total * .9, loaded, total }), modelId)
  }
  if (!blob) throw new Error('Téléchargez le modèle choisi ou importez votre fichier GGUF avant de l’utiliser.')
  post({ type: 'load-progress', modelId, phase: 'warmup', progress: .95 })
  nativeError = ''
  const log = (...args: unknown[]) => {
    const line = args.filter(arg => typeof arg === 'string').join(' ')
    if (/error loading model|failed to|WebGPU.*error|out of memory/i.test(line)) nativeError = line
    console.debug('[wllama]', ...args)
  }
  engine = new Wllama({ default: new URL('wllama/wllama.wasm', self.location.origin + '/').href }, {
    logger: { log, warn: log, error: log, debug: () => {} }, allowOffline: true,
  })
  engine.setCompat(null)
  try {
    await engine.loadModel([blob], loadingSettings)
    const info = engine.getLoadedContextInfo()
    if (!info.n_ctx || !info.n_vocab || !info.n_layer) throw new Error(nativeError || 'Le moteur n’a pas chargé le modèle.')
    const spec = getModelSpec(modelId)
    const expectedArchitecture = spec.ggufArchitecture ?? (modelId.startsWith('qwen3-') ? 'qwen3' : 'lfm3')
    if (!modelId.startsWith('custom-') && (info.metadata['general.architecture'] !== expectedArchitecture || info.metadata['general.file_type'] !== (spec.ggufFileType ?? '7'))) throw new Error('Le fichier téléchargé ne correspond pas au modèle sélectionné.')
    loadedModelId = modelId
    loadSignature = signature
    post({ type: 'load-progress', modelId, phase: 'warmup', progress: 1 })
    post({ type: 'ready', modelId })
  } catch (error) { await unloadText(); throw error }
}
function trimOldestTurn(messages: WllamaMessage[]) {
  const first = messages.findIndex(message => message.role === 'user')
  const next = messages.findIndex((message, index) => index > first && message.role === 'user')
  if (next < 0) return false
  messages.splice(first, next - first)
  return true
}
async function generate(msg: Extract<WorkerRequest, { type: 'generate' }>) {
  activeRequestId = msg.requestId
  const send = (data: WorkerResponse) => post({ ...data, requestId: msg.requestId })
  if (cancelled.delete(msg.requestId)) { send({ type: 'done', text: '', tokens: 0, tokensPerSecond: 0, promptTokens: 0, droppedTurns: 0 }); activeRequestId = null; return }
  if (getModelSpec(msg.modelId).isVision) {
    await unloadText()
    visionWorker().postMessage(msg)
    return
  }
  const stream = new WllamaStream()
  const settings = normalizeModelSettings(msg.settings)
  let tokens = 0, promptTokens = 0, speed = 0, droppedTurns = 0
  let started = performance.now(), firstTokenMs: number | null = null, finishReason = 'unknown'
  const done = () => {
    const elapsedMs = performance.now() - started
    const tokensPerSecond = speed || (tokens && elapsedMs > (firstTokenMs ?? 0) ? tokens / ((elapsedMs - (firstTokenMs ?? 0)) / 1000) : 0)
    send({ type: 'done', text: stream.text, tokens, tokensPerSecond, promptTokens, droppedTurns,
      metrics: { tokens, tokensPerSecond, promptTokens, droppedTurns, elapsedMs, firstTokenMs, finishReason: controller?.signal.aborted ? 'interrupted' : finishReason },
    })
  }
  controller = new AbortController()
  try {
    await loadText(undefined, false, msg.modelId, settings)
    started = performance.now()
    if (cancelled.delete(msg.requestId)) controller.abort()
    const messages: WllamaMessage[] = msg.messages.filter(turn => turn.role !== 'system').map((turn: ChatTurn) => ({ role: turn.role,
      content: turn.role === 'assistant' ? turn.content.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim() : turn.content,
    }))
    if (settings.systemPrompt.trim()) messages.unshift({ role: 'system', content: settings.systemPrompt.trim() })
    const evidence = msg.webEvidence
    const finalTurn = messages.at(-1)
    const originalContent = finalTurn?.content ?? ''
    const originalEvidence = evidence && [evidence.instructions, ...evidence.blocks].join('\n\n')
    let sourceCount = evidence?.blocks.length ?? 0
    // Native token counting happens before any visible output. No draft retries.
    const sampling = nativeSampling(settings)
    if (msg.modelId.startsWith('qwen3-') && msg.enableThinking && settings.temperature === .7 && settings.topP === .8) {
      sampling.temperature = .6
      sampling.top_p = .95
    }
    const options = { ...sampling, chat_template_kwargs: { enable_thinking: msg.enableThinking, preserve_thinking: false }, cache_prompt: true }
    while (true) {
      if (controller.signal.aborted) throw new DOMException('Arrêt demandé', 'AbortError')
      try {
        const preflight = await engine!.createChatCompletion({ ...options, messages, max_tokens: 1, stream: false, abortSignal: controller.signal }) as { usage?: { prompt_tokens: number } }
        promptTokens = preflight.usage?.prompt_tokens ?? 0
        if (promptTokens <= settings.contextLength - settings.maxOutputTokens) break
      } catch (error) {
        if (controller.signal.aborted) throw error
        if (!/context|too (long|large)|exceed/i.test(String(error))) throw error
      }
      if (trimOldestTurn(messages)) {
        droppedTurns++
      } else if (evidence && finalTurn && originalEvidence && originalContent.includes(originalEvidence) && sourceCount > 1) {
        sourceCount--
        finalTurn.content = originalContent.replace(originalEvidence,
          () => [evidence.instructions, ...evidence.blocks.slice(0, sourceCount)].join('\n\n'))
      } else throw new Error('Ce message et ses documents dépassent le contexte disponible. Raccourcissez-les ou ouvrez une nouvelle conversation.')
    }
    if (evidence && sourceCount !== evidence.blocks.length) send({ type: 'web-evidence-limit', sourceCount })
    send({ type: 'prefill', done: promptTokens, total: promptTokens })
    await engine!.createChatCompletion({ ...options, messages, max_tokens: settings.maxOutputTokens, stream: true,
      abortSignal: controller.signal, return_progress: true, timings_per_token: true, stream_options: { include_usage: true },
      onData(chunk: WllamaChunk) {
        const delta = chunk.choices[0]?.delta
        if (firstTokenMs === null && (delta?.content || delta?.reasoning_content)) firstTokenMs = performance.now() - started
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason
        const text = stream.append(chunk)
        if (chunk.usage) { tokens = chunk.usage.completion_tokens; promptTokens = chunk.usage.prompt_tokens }
        if (Number.isFinite(chunk.timings?.predicted_n)) tokens = chunk.timings!.predicted_n
        if (Number.isFinite(chunk.timings?.predicted_per_second)) speed = chunk.timings!.predicted_per_second
        send({ type: 'text', text })
      },
    })
    if (!controller.signal.aborted && !hasUsableAnswer(stream.text, msg.allowTools)) throw new Error('Le modèle n’a pas produit de réponse finale. Le contenu reçu est conservé ; vous pouvez réessayer ou désactiver Thinking.')
    done()
  } catch (error) {
    if (controller.signal.aborted) done()
    else send({ type: 'error', scope: 'generate', message: String((error as Error)?.message ?? error) })
  } finally { controller = null; activeRequestId = null; cancelled.delete(msg.requestId) }
}
self.onmessage = ({ data: msg }: MessageEvent<WorkerRequest>) => {
  if (msg.type === 'interrupt') {
    if (msg.requestId === activeRequestId) { controller?.abort(); vision?.postMessage(msg) }
    else if (msg.requestId === latestRequestId) cancelled.add(msg.requestId)
    return
  }
  if (msg.type === 'generate') latestRequestId = msg.requestId
  queue = queue.then(async () => {
    try {
      if (msg.type === 'check') { knownModelIds = msg.modelIds ?? knownModelIds; await cacheStatus() }
      if (msg.type === 'load') {
        if (getModelSpec(msg.modelId).isVision) { await unloadText(); visionWorker().postMessage(msg) }
        else {
          const previousSignature = loadSignature
          await loadText(msg.file, true, msg.modelId, msg.settings)
          if (previousSignature && previousSignature === loadSignature && !msg.file) post({ type: 'ready', modelId: msg.modelId })
        }
      }
      if (msg.type === 'generate') await generate(msg)
      if (msg.type === 'delete') {
        if (getModelSpec(msg.modelId).isVision) visionWorker().postMessage(msg)
        else { await unloadText(); await deleteGguf(msg.modelId); post({ type: 'deleted', modelId: msg.modelId }); await cacheStatus() }
      }
    } catch (error) {
      post({ type: 'error', scope: msg.type === 'delete' ? 'delete' : 'load', message: String((error as Error)?.message ?? error) })
    }
  })
}
