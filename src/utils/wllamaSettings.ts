// Recovered LM Studio load settings; recommended GGUF sampling is shared by both modes.
export const WLLAMA_LOAD_SETTINGS = {
  n_ctx: 8192, n_threads: 4, n_gpu_layers: 999,
  n_batch: 256, n_ubatch: 128, flash_attn: true, jinja: true,
  default_template_kwargs: { enable_thinking: false },
  reasoning_budget_tokens: 1024,
  ctx_shift: false,
}
export const WLLAMA_SAMPLING = {
  temperature: 0.1, top_k: 50, top_p: 1, min_p: 0, penalty_repeat: 1.1,
}
export const GGUF_FILE = 'LFM3-1.7B-Q8_0.gguf'
export const GGUF_BYTES = 1846238496
export const GGUF_URL = `https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF/resolve/main/${GGUF_FILE}`

export interface WllamaMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface WllamaChunk {
  choices: { delta: { content?: string; reasoning_content?: string }; finish_reason?: string | null }[]
  usage?: { prompt_tokens: number; completion_tokens: number }
  timings?: { predicted_n: number; predicted_per_second: number; prompt_n: number }
}

// Some llama.cpp formats split reasoning into a separate stream channel.
// The UI consumes one cumulative string with explicit, balanced delimiters.
export class WllamaStream {
  text = ''
  reasoningOpen = false
  append(chunk: WllamaChunk) {
    const delta = chunk.choices[0]?.delta
    if (delta?.reasoning_content) {
      if (!this.reasoningOpen) { this.text += '<think>'; this.reasoningOpen = true }
      this.text += delta.reasoning_content
    }
    if (delta?.content) {
      if (this.reasoningOpen) { this.text += '</think>'; this.reasoningOpen = false }
      this.text += delta.content
    }
    return this.text
  }
}
