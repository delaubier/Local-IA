// ONNX worker retained only for image analysis. Text chat uses wllama.
// LFM3-VL-2B q4f16 is loaded only for visual requests.

import {
  env,
  AutoTokenizer,
  AutoProcessor,
  AutoModelForCausalLM,
  AutoModelForImageTextToText,
  RawImage,
  TextStreamer,
  InterruptableStoppingCriteria,
  ModelRegistry,
  Tensor,
  ones,
} from '@huggingface/transformers'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import { ModelLoadProgress } from './utils/modelLoadProgress'
import { promptStartsThinking, hasUsableAnswer } from './utils/thinkingBudget'
import { createReasoningProcessor } from './utils/reasoningProcessor'
import { isCurrentInterrupt } from './utils/generationRun'
import { MAX_TEXT_PROMPT_TOKENS, boundedImageSize, fitVisionContext, inferenceErrorMessage } from './utils/inferenceLimits'
import {
  LFM_MODELS,
  getModelSpec,
  type ChatTurn,
  type LfmModelSpec,
  type WorkerRequest,
  type WorkerResponse,
} from './llm-protocol'

const DEVICE = 'webgpu'
const PREFILL_CHUNK_TEXT = 256
const MAX_PROMPT_TOKENS = MAX_TEXT_PROMPT_TOKENS
const MAX_NEW_TOKENS = 4096
const SAMPLING = { do_sample: true, temperature: 0.1, top_k: 50, repetition_penalty: 1.1 }

// ─── Configuration de l'environnement ONNX / Transformers.js ───
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

// Sur Windows (Chromium crbug.com/369219127), ONNX Runtime passe parfois `powerPreference`
// à `navigator.gpu.requestAdapter(options)`, ce qui déclenche un avertissement console dans `chrome://extensions`.
if (typeof navigator !== 'undefined' && (navigator as any).gpu?.requestAdapter) {
  const origRequestAdapter = (navigator as any).gpu.requestAdapter.bind((navigator as any).gpu)
  ;(navigator as any).gpu.requestAdapter = (options?: any) => {
    if (options && typeof options === 'object' && 'powerPreference' in options) {
      const { powerPreference: _ignored, ...rest } = options
      return origRequestAdapter(rest)
    }
    return origRequestAdapter(options)
  }
}

let activeRequestId: number | null = null
let activeAllowsTools = false
const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(
  ['text', 'prefill', 'done'].includes(msg.type) && activeRequestId !== null
    ? { ...msg, requestId: activeRequestId } : msg,
)

let activeSpec: LfmModelSpec | null = null
let tokenizer: any = null
let processor: any = null
let model: any = null
let loadingModelId: string | null = null
let loadPromise: Promise<void> | null = null
const stopping = new InterruptableStoppingCriteria()

const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator

async function checkAllCached(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {}
  for (const spec of LFM_MODELS.filter((item) => item.isVision)) {
    try {
      const cached = await ModelRegistry.is_cached(spec.repoId, {
        dtype: spec.dtype,
        device: DEVICE,
      } as any)
      result[spec.id] = cached || activeSpec?.id === spec.id
    } catch {
      result[spec.id] = activeSpec?.id === spec.id
    }
  }
  return result
}

async function unloadCurrentModel() {
  if (model) {
    try {
      await model.dispose()
    } catch {
      /* ignore */
    }
  }
  model = null
  tokenizer = null
  processor = null
  activeSpec = null
}

function loadModel(modelId: string): Promise<void> {
  const spec = getModelSpec(modelId)
  if (!spec.isVision) return Promise.reject(new Error('Ce worker est réservé aux images.'))
  if (model && activeSpec?.id === spec.id) return Promise.resolve()
  if (loadPromise && loadingModelId === spec.id) return loadPromise

  loadingModelId = spec.id
  loadPromise = (async () => {
    post({ type: 'load-progress', modelId: spec.id, phase: 'download', progress: 0 })
    if (!hasWebGPU()) throw new Error("WebGPU n'est pas disponible dans ce navigateur.")
    const adapter = await (navigator as any).gpu.requestAdapter()
    if (!adapter) throw new Error('Aucun adaptateur WebGPU trouvé (GPU non supporté ou désactivé).')
    if (!adapter.features.has('shader-f16')) {
      throw new Error("Votre GPU ne supporte pas 'shader-f16', requis par la variante q4f16 de LFM3.")
    }

    if (model && activeSpec?.id !== spec.id) {
      await unloadCurrentModel()
    }

    // Discover the complete model file budget once, including external ONNX data.
    // Metadata comes from the cache when available. Failure must not block loading.
    let plannedFiles: { file: string; size?: number }[] = []
    try {
      const names = await ModelRegistry.get_model_files(spec.repoId, { dtype: spec.dtype, device: DEVICE } as any)
      const metadata = await Promise.allSettled(names.map((file) => ModelRegistry.get_file_metadata(spec.repoId, file)))
      plannedFiles = names.map((file, index) => {
        const result = metadata[index]
        return { file, size: result.status === 'fulfilled' ? result.value.size : undefined }
      })
    } catch { /* Fall back to stage progress if metadata is unavailable. */ }
    const loadProgress = new ModelLoadProgress(plannedFiles)
    const progress_callback = (p: any) => {
      if (!['progress', 'done'].includes(p.status) || !p.file) return
      post({
        type: 'load-progress',
        modelId: spec.id,
        phase: 'download',
        progress: loadProgress.update(p),
      })
    }

    if (spec.isVision) {
      processor = await AutoProcessor.from_pretrained(spec.repoId, { progress_callback })
      // Limite la résolution max envoyée au Vision Encoder (~640x640 = 1600 patchs max -> ~312 Mo au lieu de 2,64 Go)
      // pour ne jamais dépasser la limite WebGPU maxBufferSize de 2,14 Go (2147483648 octets) sur les écrans HD/4K.
      if (processor?.image_processor) {
        const maxSafePixels = 640 * 640
        processor.image_processor.max_pixels = maxSafePixels
        if (processor.image_processor.config) {
          processor.image_processor.config.max_pixels = maxSafePixels
        }
        processor.image_processor.max_tiles = 2
      }
      tokenizer = processor.tokenizer
      model = await AutoModelForImageTextToText.from_pretrained(spec.repoId, {
        dtype: spec.dtype,
        device: DEVICE,
        progress_callback,
      } as any)
    } else {
      tokenizer = await AutoTokenizer.from_pretrained(spec.repoId, { progress_callback })
      processor = null
      model = await AutoModelForCausalLM.from_pretrained(spec.repoId, {
        dtype: spec.dtype,
        device: DEVICE,
        progress_callback,
      } as any)
    }

    // Compatibilité avec les graphes ONNX de LiquidAI qui attendent `logits_to_keep` (int64[1])
    const origForward = model._forward
    const logitsToKeep = new Tensor('int64', BigInt64Array.from([1n]), [1])
    model._forward = (self: any, modelInputs: any) => {
      modelInputs.logits_to_keep ??= logitsToKeep
      return origForward(self, modelInputs)
    }

    // Préchauffage des shaders WebGPU
    post({ type: 'load-progress', modelId: spec.id, phase: 'warmup', progress: loadProgress.preparing() })
    const warm = tokenizer('Bonjour')
    await model.generate({ ...warm, max_new_tokens: 1, do_sample: false })
    activeSpec = spec
    post({ type: 'load-progress', modelId: spec.id, phase: 'warmup', progress: loadProgress.ready() })
  })()

  loadPromise.catch(() => {
    loadPromise = null
    loadingModelId = null
    model = null
    activeSpec = null
  })
  return loadPromise
}

// ─── Construction du prompt Texte ───

function renderTextTemplate(messages: ChatTurn[], enableThinking: boolean): number[] {
  try {
    const cleanMsgs = messages.map((m) => ({ role: m.role, content: m.content }))
    const ids = tokenizer.apply_chat_template(cleanMsgs, {
      add_generation_prompt: true,
      enable_thinking: enableThinking,
      tokenize: true,
      return_tensor: false,
      return_dict: false,
    })
    return Array.isArray(ids[0]) ? ids[0] : ids
  } catch (err) {
    console.warn('apply_chat_template a échoué, utilisation du format ChatML manuel', err)
    let text = '<|startoftext|>'
    for (const m of messages) {
      if (m.role === 'assistant') text += `<|im_start|>assistant\n<think></think>${m.content}<|im_end|>\n`
      else text += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`
    }
    text += '<|im_start|>assistant\n' + (enableThinking ? '<think>' : '<think></think>')
    return tokenizer.encode(text, { add_special_tokens: false })
  }
}

function buildTextPrompt(messages: ChatTurn[], enableThinking: boolean) {
  const system = messages[0]?.role === 'system' ? [messages[0]] : []
  let turns = messages.slice(system.length)
  let dropped = 0
  let ids = renderTextTemplate([...system, ...turns], enableThinking)

  while (ids.length > MAX_PROMPT_TOKENS && turns.length > 1) {
    let cut = 1
    while (cut < turns.length - 1 && turns[cut].role !== 'user') cut++
    turns = turns.slice(cut)
    dropped += cut
    ids = renderTextTemplate([...system, ...turns], enableThinking)
  }

  if (ids.length > MAX_PROMPT_TOKENS) {
    throw new Error(
      `Le message est trop long (${ids.length} tokens, maximum ${MAX_PROMPT_TOKENS}). Réduisez la taille du document joint.`,
    )
  }
  return { ids, dropped }
}

const toInputIds = (ids: number[]) => new Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length])
const cleanText = (s: string) => s.replace(/<\|[^|>]*\|>/g, '')

// Keep the final answer budget intact instead of interrupting model.generate().
function reasoningControl(promptLength: number, initiallyThinking: boolean, enabled: boolean) {
  const opening: number[] = tokenizer.encode('<think>', { add_special_tokens: false })
  const closing: number[] = tokenizer.encode('</think>', { add_special_tokens: false })
  const eos = model.generation_config?.eos_token_id ?? tokenizer.eos_token_id
  const endTokens: number[] = Array.isArray(eos) ? eos : typeof eos === 'number' ? [eos] : []
  return createReasoningProcessor({ promptLength, opening, closing, endTokens, initiallyThinking, enabled })
}

async function disposeCache(cache: any) {
  try {
    await cache?.dispose?.()
  } catch {
    /* ignore */
  }
}

async function prepareVisionInputs(messages: ChatTurn[], enableThinking: boolean) {
  // Collecte l'image la plus récente pour préserver la VRAM et rester sous la limite WebGPU de 2,14 Go par buffer
  const allImageUrls: string[] = []
  for (const m of messages) {
    if (m.images?.length) {
      for (const img of m.images) allImageUrls.push(img)
    }
  }
  const keptImageUrls = allImageUrls.slice(-1)
  let remainingToSkip = allImageUrls.length - keptImageUrls.length

  const templateMessages = messages.map((m) => {
    if (m.role !== 'user' || !m.images || m.images.length === 0) {
      return { role: m.role, content: m.content }
    }
    const turnImages: string[] = []
    for (const img of m.images) {
      if (remainingToSkip > 0) {
        remainingToSkip--
      } else {
        turnImages.push(img)
      }
    }
    if (turnImages.length === 0) {
      return { role: m.role, content: m.content }
    }
    return {
      role: 'user',
      content: [
        ...turnImages.map(() => ({ type: 'image' })),
        { type: 'text', text: m.content || 'Décris cette image.' },
      ],
    }
  })

  const chatPrompt = processor.apply_chat_template(templateMessages, {
    add_generation_prompt: true,
    enable_thinking: enableThinking,
  })

  const rawImages =
    keptImageUrls.length > 0 ? await Promise.all(keptImageUrls.map(async (u) => {
      const image = await RawImage.fromURL(u)
      const size = boundedImageSize(image.width, image.height)
      return size.width === image.width && size.height === image.height ? image : image.resize(size.width, size.height)
    })) : null

  const inputs = await processor(rawImages, chatPrompt, { add_special_tokens: false })
  return { value: { inputs, chatPrompt }, tokens: inputs.input_ids?.dims?.at(-1) ?? 0 }
}

async function disposeVisionInputs(value: { inputs: Record<string, any> }) {
  for (const tensor of Object.values(value.inputs)) await disposeCache(tensor)
}

async function generateWithVisionProcessor(messages: ChatTurn[], enableThinking: boolean) {
  const started = performance.now()
  const { value: { inputs, chatPrompt }, tokens: promptTokens, dropped } = await fitVisionContext(
    messages,
    (turns) => prepareVisionInputs(turns, enableThinking),
    disposeVisionInputs,
  )

  const initiallyThinking = promptStartsThinking(chatPrompt)
  let text = initiallyThinking ? '<think>' : ''
  let generated = 0
  let firstTokenAt = 0

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (chunk: string) => {
      text += chunk
      post({ type: 'text', text: cleanText(text) })
    },
    token_callback_function: () => {
      if (!firstTokenAt) firstTokenAt = performance.now()
      generated++
    },
  } as any)

  let result: any
  try {
    result = await model.generate({
      ...inputs,
      ...SAMPLING,
      max_new_tokens: MAX_NEW_TOKENS,
      logits_processor: reasoningControl(promptTokens, initiallyThinking, enableThinking),
      streamer,
      stopping_criteria: stopping,
      return_dict_in_generate: true,
    })
  } finally {
    await disposeVisionInputs({ inputs })
  }

  await disposeCache(result?.past_key_values)

  if (!stopping.interrupted && !hasUsableAnswer(text, activeAllowsTools)) {
    throw new Error("Le modèle n’a pas terminé sa réponse. Le contenu déjà affiché est conservé ; vous pouvez réessayer ou reformuler votre question.")
  }

  const seconds = firstTokenAt ? (performance.now() - firstTokenAt) / 1000 : 0
  post({
    type: 'done',
    text: cleanText(text),
    tokens: generated,
    tokensPerSecond: seconds > 0 ? generated / seconds : 0,
    promptTokens,
    droppedTurns: dropped,
    metrics: { tokens: generated, promptTokens, droppedTurns: dropped, tokensPerSecond: seconds > 0 ? generated / seconds : 0,
      elapsedMs: performance.now() - started, firstTokenMs: firstTokenAt ? firstTokenAt - started : null,
      finishReason: stopping.interrupted ? 'interrupted' : generated >= MAX_NEW_TOKENS ? 'length' : 'stop' },
  })
}

async function generate(modelId: string, messages: ChatTurn[], enableThinking: boolean): Promise<void> {
  const started = performance.now()
  await loadModel(modelId)

  const hasImages = messages.some((m) => m.images && m.images.length > 0)

  // Si le modèle est LFM3-Omni-2B (Vision+Texte) et qu'une image est présente (ou processor actif)
  if (activeSpec?.isVision && processor && hasImages) {
    await generateWithVisionProcessor(messages, enableThinking)
    return
  }

  // Chemin Texte / Code avec découpage prefill par blocs (256 tokens pour LFM3-1.7B, 1024 pour LFM3-Omni-2B)
  const chunkSize = activeSpec?.isVision ? 512 : PREFILL_CHUNK_TEXT
  const { ids, dropped } = buildTextPrompt(messages, enableThinking)
  const total = ids.length

  let cache: any = undefined
  let done = 0
  while (total - done > chunkSize && !stopping.interrupted) {
    const end = done + chunkSize
    const out = await model.generate({
      input_ids: toInputIds(ids.slice(0, end)),
      attention_mask: ones([1, end]),
      ...(cache ? { past_key_values: cache } : {}),
      max_new_tokens: 1,
      do_sample: false,
      return_dict_in_generate: true,
    })
    if (cache && cache !== out.past_key_values) await disposeCache(cache)
    cache = out.past_key_values
    done = end
    post({ type: 'prefill', done, total })
  }

  if (stopping.interrupted) {
    await disposeCache(cache)
    post({ type: 'done', tokens: 0, tokensPerSecond: 0, promptTokens: total, droppedTurns: dropped })
    return
  }

  const initiallyThinking = promptStartsThinking(tokenizer.decode(ids.slice(-32), { skip_special_tokens: false }))
  let text = initiallyThinking ? '<think>' : ''
  let generated = 0
  let firstTokenAt = 0
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (chunk: string) => {
      text += chunk
      post({ type: 'text', text: cleanText(text) })
    },
    token_callback_function: () => {
      if (!firstTokenAt) firstTokenAt = performance.now()
      generated++
    },
  } as any)

  const result = await model.generate({
    input_ids: toInputIds(ids),
    attention_mask: ones([1, total]),
    ...(cache ? { past_key_values: cache } : {}),
    ...SAMPLING,
    max_new_tokens: MAX_NEW_TOKENS,
    logits_processor: reasoningControl(total, initiallyThinking, enableThinking),
    streamer,
    stopping_criteria: stopping,
    return_dict_in_generate: true,
  })

  if (cache && cache !== result.past_key_values) await disposeCache(cache)
  await disposeCache(result.past_key_values)

  if (!stopping.interrupted && !hasUsableAnswer(text, activeAllowsTools)) {
    throw new Error("Le modèle n’a pas terminé sa réponse. Le contenu déjà affiché est conservé ; vous pouvez réessayer ou reformuler votre question.")
  }

  const seconds = firstTokenAt ? (performance.now() - firstTokenAt) / 1000 : 0
  post({
    type: 'done',
    text: cleanText(text),
    tokens: generated,
    tokensPerSecond: seconds > 0 ? generated / seconds : 0,
    promptTokens: total,
    droppedTurns: dropped,
    metrics: { tokens: generated, promptTokens: total, droppedTurns: dropped, tokensPerSecond: seconds > 0 ? generated / seconds : 0,
      elapsedMs: performance.now() - started, firstTokenMs: firstTokenAt ? firstTokenAt - started : null,
      finishReason: stopping.interrupted ? 'interrupted' : generated >= MAX_NEW_TOKENS ? 'length' : 'stop' },
  })
}

async function deleteModel(modelId: string) {
  const spec = getModelSpec(modelId)
  if (activeSpec?.id === spec.id) {
    await unloadCurrentModel()
    loadPromise = null
    loadingModelId = null
  }
  await ModelRegistry.clear_cache(spec.repoId, { dtype: spec.dtype, device: DEVICE } as any)
}

let queue: Promise<void> = Promise.resolve()

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  switch (msg.type) {
    case 'check':
      checkAllCached().then((cachedMap) =>
        post({
          type: 'cache-status',
          cachedMap,
          loadedModelId: activeSpec?.id ?? null,
          webgpu: hasWebGPU(),
        }),
      )
      break
    case 'load':
      loadModel(msg.modelId)
        .then(async () => {
          post({ type: 'ready', modelId: getModelSpec(msg.modelId).id })
          const cachedMap = await checkAllCached()
          post({ type: 'cache-status', cachedMap, loadedModelId: activeSpec?.id ?? null, webgpu: hasWebGPU() })
        })
        .catch((e) => post({ type: 'error', scope: 'load', message: String(e?.message ?? e) }))
      break
    case 'generate':
      queue = queue.then(async () => {
        activeRequestId = msg.requestId
        activeAllowsTools = msg.allowTools
        stopping.reset()
        const targetSpec = getModelSpec(msg.modelId)
        const wasLoaded = activeSpec?.id === targetSpec.id && !!model
        try {
          if (!wasLoaded && !(await ModelRegistry.is_cached(targetSpec.repoId, { dtype: targetSpec.dtype, device: DEVICE } as any))) {
            throw new Error(`Téléchargez ${targetSpec.name} avant de l’utiliser.`)
          }
          await loadModel(targetSpec.id)
          if (!wasLoaded) {
            post({ type: 'ready', modelId: targetSpec.id })
            const cachedMap = await checkAllCached()
            post({ type: 'cache-status', cachedMap, loadedModelId: activeSpec?.id ?? null, webgpu: hasWebGPU() })
          }
        } catch (e: any) {
          post({ type: 'error', scope: 'load', message: String(e?.message ?? e), requestId: msg.requestId })
          activeRequestId = null
          return
        }
        try {
          const messages = msg.messages.filter(turn => turn.role !== 'system')
          if (msg.settings?.systemPrompt?.trim()) messages.unshift({ role: 'system', content: msg.settings.systemPrompt.trim() })
          await generate(targetSpec.id, messages, msg.enableThinking)
        } catch (e: any) {
          console.error(e)
          post({ type: 'error', scope: 'generate', message: inferenceErrorMessage(e), requestId: msg.requestId })
        } finally {
          activeRequestId = null
        }
      })
      break
    case 'interrupt':
      if (isCurrentInterrupt(activeRequestId, msg.requestId)) stopping.interrupt()
      break
    case 'delete':
      queue = queue.then(async () => {
        try {
          const spec = getModelSpec(msg.modelId)
          await deleteModel(spec.id)
          post({ type: 'deleted', modelId: spec.id })
          const cachedMap = await checkAllCached()
          post({ type: 'cache-status', cachedMap, loadedModelId: activeSpec?.id ?? null, webgpu: hasWebGPU() })
        } catch (e: any) {
          post({ type: 'error', scope: 'delete', message: String(e?.message ?? e) })
        }
      })
      break
  }
}
