import { Wllama, type ChatCompletionMessage, type ChatCompletionChunk } from '../.local/wllama-evaluation/source/wllama-a24b3564dd3c108af85a79a2c3b08a88bd2e7370/src/index'
import wasmUrl from '../.local/wllama-evaluation/wllama.wasm?url'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = el('status')
const error = el('error')
const logs = el('logs')
const results = el('results')
const fileInput = el<HTMLInputElement>('file')
const load = el<HTMLButtonElement>('load')
const backend = el<HTMLSelectElement>('backend')
const context = el<HTMLSelectElement>('context')
const question = el<HTMLTextAreaElement>('question')
let llm: Wllama | null = null
let abort: AbortController | null = null
let history: ChatCompletionMessage[] = []
let busy = false
const report: { engine: string; llamaVersion: string; settings?: unknown; model?: unknown; loadMs?: number; results: unknown[]; errors: string[]; logs: string[] } = {
  engine: 'wllama 3.12.0 (compilation officielle)', llamaVersion: Wllama.getLibllamaVersion(), results: [], errors: [], logs: [],
}
function log(...args: unknown[]) {
  const text = args.map(x => {
    if (typeof x === 'string') return x
    // The native diagnostic also returns the complete Jinja template: keep the log readable.
    if (x && typeof x === 'object' && 'loadedCtxInfo' in x) {
      const info = x.loadedCtxInfo as { success: boolean; n_ctx: number; n_layer: number }
      return JSON.stringify({ loadedCtxInfo: { success: info.success, n_ctx: info.n_ctx, n_layer: info.n_layer } })
    }
    return JSON.stringify(x)
  }).join(' ')
  report.logs.push(text)
  logs.textContent = report.logs.slice(-100).join('\n')
  logs.scrollTop = logs.scrollHeight
}
function controls() {
  const ready = !!llm?.isModelLoaded()
  load.disabled = busy || ready
  fileInput.disabled = busy || ready
  backend.disabled = busy || ready
  context.disabled = busy || ready
  for (const id of ['send', 'suite', 'clear', 'unload']) el<HTMLButtonElement>(id).disabled = busy || !ready
  el<HTMLButtonElement>('stop').disabled = !abort
}
function failure(e: unknown) {
  const message = e instanceof Error ? e.message : String(e)
  error.textContent = message
  report.errors.push(message)
  status.textContent = 'Le test a rencontré une erreur. Consultez le diagnostic.'
}
const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{info?: unknown} | null> } }).gpu
el('info').textContent = `${report.engine} · llama.cpp ${report.llamaVersion} · isolation multithread : ${crossOriginIsolated ? 'oui' : 'non'} · WebGPU : ${gpu ? 'disponible' : 'absent'}`
if (gpu) gpu.requestAdapter().then(adapter => { log('Adaptateur WebGPU', adapter?.info ?? 'indisponible') }).catch(log)

load.onclick = async () => {
  busy = true
  error.textContent = ''
  controls()
  const start = performance.now()
  try {
    let file: Blob
    if (fileInput.files?.[0]) {
      file = fileInput.files[0]
      report.model = { name: fileInput.files[0].name, bytes: file.size }
    } else {
      status.textContent = 'Lecture de votre fichier local…'
      const response = await fetch('/test-model.gguf')
      if (!response.ok) throw new Error(await response.text())
      file = await response.blob()
      report.model = { name: 'LFM3-1.7B-Q8_0.gguf', bytes: file.size }
    }
    if (await file.slice(0, 4).text() !== 'GGUF') throw new Error('Ce fichier ne possède pas un en-tête GGUF.')
    status.textContent = `Préparation du GGUF · ${(file.size / 1e9).toFixed(2)} Go…`
    llm = new Wllama({ default: wasmUrl }, { logger: { log, debug: log, warn: log, error: log } })
    // Do not fetch executable compatibility assets from a CDN.
    llm.setCompat(null)
    const settings = { n_ctx: Number(context.value), n_batch: 256, n_ubatch: 128, n_threads: 4,
      n_gpu_layers: backend.value === 'gpu' ? 999 : 0, flash_attn: true,
      jinja: true, default_template_kwargs: { enable_thinking: false }, seed: 42 }
    report.settings = settings
    log('Chargement', report.model, settings)
    await llm.loadModel([file], settings)
    const info = llm.getLoadedContextInfo()
    // 3.8.1 resolves loadModel even when native load_res.success is false.
    if (!info.n_ctx || !info.n_vocab || !info.n_layer) {
      throw new Error('Le moteur n’a pas chargé le modèle. ' + (report.logs.findLast(line => line.includes('error loading model:')) ?? 'Consultez le diagnostic natif.'))
    }
    report.loadMs = performance.now() - start
    log('Contexte chargé', { n_ctx: info.n_ctx, n_layer: info.n_layer, architecture: info.metadata['general.architecture'], threads: llm.getNumThreads() })
    status.textContent = `Modèle prêt · ${(report.loadMs / 1000).toFixed(1)} s · contexte ${info.n_ctx} · ${backend.value === 'gpu' ? 'WebGPU demandé (voir diagnostic)' : 'CPU'}`
  } catch (e) {
    failure(e)
    await llm?.exit().catch(log)
    llm = null
  } finally { busy = false; controls() }
}
async function generate(messages: ChatCompletionMessage[], title: string) {
  if (!llm?.isModelLoaded()) throw new Error('Chargez le modèle avant de poser une question.')
  const article = document.createElement('article')
  const heading = document.createElement('h2')
  heading.textContent = title
  const answer = document.createElement('pre')
  const metrics = document.createElement('small')
  article.append(heading, answer, metrics)
  results.append(article)
  const started = performance.now()
  let firstTokenMs: number | null = null
  let output = ''
  let finish: string | null = null
  let timings: unknown
  const enableThinking = el<HTMLInputElement>('thinking').checked
  abort = new AbortController()
  const timeout = setTimeout(() => abort?.abort(), 120_000)
  controls()
  status.textContent = 'Génération en cours…'
  try {
    await llm.createChatCompletion({ messages, stream: true,
      max_tokens: 4096, temperature: 0.1, top_k: 50, top_p: 1, min_p: 0,
      penalty_repeat: 1.1, seed: 42, chat_template_kwargs: { enable_thinking: enableThinking },
      abortSignal: abort.signal, cache_prompt: false,
      onData(chunk: ChatCompletionChunk) {
        const delta = chunk.choices[0]?.delta.content ?? ''
        const reasoning = (chunk.choices[0]?.delta as { reasoning_content?: string })?.reasoning_content
        if (reasoning) log('reasoning_content', reasoning)
        if (delta && firstTokenMs === null) firstTokenMs = performance.now() - started
        output += delta
        answer.textContent = output
        finish = chunk.choices[0]?.finish_reason ?? finish
        timings = chunk.timings ?? timings
      },
    })
    const elapsedMs = performance.now() - started
    metrics.textContent = `${(elapsedMs / 1000).toFixed(2)} s · premier texte ${firstTokenMs === null ? 'absent' : (firstTokenMs / 1000).toFixed(2) + ' s'} · fin : ${finish ?? 'inconnue'}`
    report.results.push({ title, messages, enableThinking, maxTokens: 4096, output, elapsedMs, firstTokenMs, finish, timings })
    status.textContent = 'Réponse terminée.'
    return output
  } finally { clearTimeout(timeout); abort = null; controls() }
}
el('send').onclick = async () => {
  const text = question.value.trim()
  if (!text || busy) return
  busy = true; error.textContent = ''; controls()
  const messages: ChatCompletionMessage[] = [...history, { role: 'user', content: text }]
  try {
    const output = await generate(messages, text)
    history = [...messages, { role: 'assistant', content: output }]
    question.value = ''
  } catch(e) { failure(e) } finally { busy = false; controls() }
}
el('suite').onclick = async () => {
  busy = true; error.textContent = ''; controls()
  const cases: { title: string; messages: ChatCompletionMessage[] }[] = [
    { title: 'Français · explication simple', messages: [{ role: 'user', content: 'Explique en deux phrases simples pourquoi le ciel est bleu.' }] },
    { title: 'Documents contradictoires · ne pas inventer une valeur unique', messages: [{ role: 'user', content: 'Document A (2023) : le capteur Alba mesure 10 cm. Document B (2025) : le capteur Alba mesure 14 cm. Quelle est la taille du capteur Alba ? Distingue les versions et cite [1] pour A et [2] pour B.' }] },
    { title: 'Changement de sujet · traduction', messages: [{ role: 'user', content: 'Je cherche un logement à Rennes.' }, { role: 'assistant', content: 'Quel est votre budget mensuel ?' }, { role: 'user', content: 'Changeons de sujet. Traduis uniquement en français : The red bicycle.' }] },
    { title: 'Anglais · suivre la langue demandée', messages: [{ role: 'user', content: 'In English, explain the difference between weather and climate in two short sentences.' }] },
  ]
  try { for (const test of cases) await generate(test.messages, test.title) }
  catch(e) { failure(e) }
  finally { busy = false; controls() }
}
el('stop').onclick = () => abort?.abort()
el('clear').onclick = () => { history = []; results.replaceChildren(); status.textContent = 'Nouvelle conversation · contexte vide.' }
el('unload').onclick = async () => { busy = true; controls(); try { await llm?.exit(); llm = null; history = []; status.textContent = 'Modèle libéré.' } catch(e) { failure(e) } finally { busy = false; controls() } }
el('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'wllama-q8-evaluation.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
fileInput.onchange = () => { load.textContent = fileInput.files?.length ? 'Charger le fichier sélectionné' : 'Charger le fichier local configuré' }
controls()
