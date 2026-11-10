// Public subset used by LocalAI; implementation is prepared from pinned upstream.
declare module '*vendor/generated/wllama.js' {
  export class Wllama {
    constructor(paths: { default: string }, config?: { logger?: Record<string, (...args: unknown[]) => void>; allowOffline?: boolean })
    static getLibllamaVersion(): string
    setCompat(value: null): void
    isModelLoaded(): boolean
    loadModel(files: Blob[], options: object): Promise<void>
    getLoadedContextInfo(): { n_ctx: number; n_vocab: number; n_layer: number; metadata: Record<string, string> }
    createChatCompletion(options: object): Promise<unknown>
    createCompletion(options: object): Promise<{ usage: { prompt_tokens: number } }>
    exit(): Promise<void>
  }
}
