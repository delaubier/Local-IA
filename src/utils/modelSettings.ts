export interface ModelSettings {
  contextLength: number; maxOutputTokens: number; systemPrompt: string
  temperature: number; topK: number; topP: number; minP: number
  repeatPenalty: number; repeatLastN: number; presencePenalty: number; frequencyPenalty: number
  seed: number; reasoningBudget: number; stopSequences: string
  threads: number; batchSize: number; microBatchSize: number; flashAttention: boolean
}
export interface ImportedModel { id: string; name: string; bytes: number }
export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  contextLength: 8192, maxOutputTokens: 4096, systemPrompt: '',
  temperature: .1, topK: 50, topP: 1, minP: 0, repeatPenalty: 1.1, repeatLastN: 64,
  presencePenalty: 0, frequencyPenalty: 0, seed: -1, reasoningBudget: 1024, stopSequences: '',
  threads: 4, batchSize: 256, microBatchSize: 128, flashAttention: true,
}
export function settingsForModel(modelId: string, input?: Partial<ModelSettings>): ModelSettings {
  const qwen = modelId.startsWith('qwen3-') || modelId.startsWith('qwen35-')
  return normalizeModelSettings({
    ...(qwen ? { temperature: .7, topK: 20, topP: .8, repeatPenalty: 1, presencePenalty: 1.5 } : {}),
    ...input,
  })
}
export function normalizeModelSettings(input: Partial<ModelSettings> = {}): ModelSettings {
  const value = { ...DEFAULT_MODEL_SETTINGS, ...input }
  const number = (key: keyof ModelSettings, min: number, max: number, integer = false) => {
    const raw = Number(value[key])
    const fallback = Number(DEFAULT_MODEL_SETTINGS[key])
    const safe = Math.min(max, Math.max(min, Number.isFinite(raw) ? raw : fallback))
    return integer ? Math.floor(safe) : safe
  }
  const contextLength = number('contextLength', 512, 262144, true)
  const maxOutputTokens = Math.min(number('maxOutputTokens', 1, 131072, true), contextLength - 128)
  return {
    contextLength, maxOutputTokens, systemPrompt: String(value.systemPrompt ?? '').slice(0, 32000),
    temperature: number('temperature', 0, 2), topK: number('topK', 0, 1000, true),
    topP: number('topP', .01, 1), minP: number('minP', 0, 1), repeatPenalty: number('repeatPenalty', .5, 2),
    repeatLastN: number('repeatLastN', -1, 32768, true), presencePenalty: number('presencePenalty', -2, 2),
    frequencyPenalty: number('frequencyPenalty', -2, 2), seed: number('seed', -1, 2147483647, true),
    reasoningBudget: value.reasoningBudget === -1 ? -1 : Math.min(number('reasoningBudget', 0, 131072, true), Math.max(0, maxOutputTokens - 1)),
    stopSequences: String(value.stopSequences ?? '').slice(0, 4000), threads: number('threads', 1, 64, true),
    batchSize: number('batchSize', 16, 2048, true), microBatchSize: Math.min(number('microBatchSize', 16, 512, true), number('batchSize', 16, 2048, true)),
    flashAttention: value.flashAttention !== false,
  }
}
export function readModelSettings(): Record<string, ModelSettings> {
  try { const saved = JSON.parse(localStorage.getItem('localaiModelSettings') || '{}'); return Object.fromEntries(Object.entries(saved).map(([id, value]) => [id, normalizeModelSettings(value as ModelSettings)])) } catch { return {} }
}
export function readImportedModels(): ImportedModel[] {
  try { return JSON.parse(localStorage.getItem('localaiImportedModels') || '[]').filter((m: ImportedModel) => /^custom-[a-z0-9-]+$/.test(m.id) && typeof m.name === 'string' && m.bytes > 0) } catch { return [] }
}
export function nativeLoadSettings(settings: ModelSettings) {
  return { n_ctx: settings.contextLength, n_threads: settings.threads, n_gpu_layers: 999,
    n_batch: settings.batchSize, n_ubatch: settings.microBatchSize, flash_attn: settings.flashAttention,
    jinja: true, ctx_shift: false, reasoning_budget_tokens: settings.reasoningBudget,
    default_template_kwargs: { enable_thinking: false },
  }
}
export function nativeSampling(settings: ModelSettings) {
  return { temperature: settings.temperature, top_k: settings.topK, top_p: settings.topP, min_p: settings.minP,
    penalty_repeat: settings.repeatPenalty, penalty_last_n: settings.repeatLastN,
    presence_penalty: settings.presencePenalty, frequency_penalty: settings.frequencyPenalty,
    ...(settings.seed >= 0 ? { seed: settings.seed } : {}),
    stop: settings.stopSequences.split('\n').map(s => s.trim()).filter(Boolean),
  }
}
