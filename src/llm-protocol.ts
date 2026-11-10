// Protocole de messages entre l'interface (App.tsx) et le Web Worker d'inférence (worker.ts).
import type { ModelSettings } from './utils/modelSettings'

export interface GenerationMetrics {
  tokens: number; promptTokens: number; tokensPerSecond: number
  elapsedMs: number; firstTokenMs: number | null; finishReason: string; droppedTurns: number
}

export interface LfmModelSpec {
  id: string
  name: string
  shortName: string
  repoId: string
  dtype: string
  sizeLabel: string
  vramLabel: string
  contextLabel: string
  isVision: boolean
  description: string
  ggufFile?: string
  ggufBytes?: number
  ggufUrl?: string
  ggufArchitecture?: string
  ggufFileType?: string
  supportsThinking?: boolean
  legacy?: boolean
}

export const LFM_MODELS: LfmModelSpec[] = [
  {
    id: 'lfm3-text-1.7b-q8',
    name: 'LFM3-1.7B Q8',
    shortName: 'LFM3-1.7B',
    repoId: 'LiquidAI/LFM3-1.7B-GGUF',
    dtype: 'Q8_0',
    sizeLabel: '1,85 Go',
    vramLabel: 'Variable selon le contexte',
    contextLabel: '8 192 tokens de contexte texte',
    isVision: false,
    description: 'Modèle texte Q8 avec wllama et WebGPU. Exécution locale.',
    ggufFile: 'LFM3-1.7B-Q8_0.gguf',
    ggufBytes: 1846238496,
    ggufUrl: 'https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF/resolve/main/LFM3-1.7B-Q8_0.gguf',
  },
  {
    id: 'qwen35-text-0.8b-q8', name: 'Qwen3.5-0.8B Q8', shortName: 'Qwen3.5-0.8B',
    repoId: 'unsloth/Qwen3.5-0.8B-GGUF', dtype: 'Q8_0', sizeLabel: '812 Mo',
    vramLabel: 'Plus léger', contextLabel: '8 192 tokens de contexte texte',
    isVision: false, description: 'Modèle compact pour les tâches simples et les résumés courts.',
    ggufFile: 'Qwen3.5-0.8B-Q8_0.gguf', ggufBytes: 811843840,
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q8_0.gguf',
    ggufArchitecture: 'qwen35', ggufFileType: '7', supportsThinking: false,
  },
  {
    id: 'qwen35-text-2b-q6', name: 'Qwen3.5-2B Q6', shortName: 'Qwen3.5-2B',
    repoId: 'unsloth/Qwen3.5-2B-GGUF', dtype: 'Q6_K', sizeLabel: '1,57 Go',
    vramLabel: 'Variable selon le contexte', contextLabel: '8 192 tokens de contexte texte',
    isVision: false, description: 'Alternative compacte pour le chat et les documents.',
    ggufFile: 'Qwen3.5-2B-Q6_K.gguf', ggufBytes: 1574961408,
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q6_K.gguf',
    ggufArchitecture: 'qwen35', ggufFileType: '18', supportsThinking: false,
  },
  {
    id: 'qwen3-text-4b-instruct-q4', name: 'Qwen3-4B Instruct Q4', shortName: 'Qwen3-4B Instruct',
    repoId: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', dtype: 'Q4_K_M', sizeLabel: '2,50 Go',
    vramLabel: 'Pour les configurations puissantes', contextLabel: '8 192 tokens de contexte texte',
    isVision: false, description: 'Option avancée pour les demandes complexes. Utilise davantage de mémoire.',
    ggufFile: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', ggufBytes: 2497281120,
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    ggufArchitecture: 'qwen3', ggufFileType: '15', supportsThinking: false,
  },
  {
    id: 'qwen3-text-1.7b-q8', name: 'Qwen3-1.7B Q8', shortName: 'Qwen3-1.7B',
    repoId: 'Qwen/Qwen3-1.7B-GGUF', dtype: 'Q8_0', sizeLabel: '1,83 Go',
    vramLabel: 'Variable selon le contexte', contextLabel: '8 192 tokens de contexte texte',
    isVision: false, description: 'Alternative multilingue. Exécution locale avec wllama et WebGPU.',
    ggufFile: 'Qwen3-1.7B-Q8_0.gguf', ggufBytes: 1834426016,
    ggufUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf',
    legacy: true,
  },
  {
    id: 'qwen3-text-0.6b-q8', name: 'Qwen3-0.6B Q8', shortName: 'Qwen3-0.6B',
    repoId: 'Qwen/Qwen3-0.6B-GGUF', dtype: 'Q8_0', sizeLabel: '0,64 Go',
    vramLabel: 'Plus léger', contextLabel: '8 192 tokens de contexte texte',
    isVision: false, description: 'Plus léger pour les PC limités. Réponses potentiellement moins précises.',
    ggufFile: 'Qwen3-0.6B-Q8_0.gguf', ggufBytes: 639446688,
    ggufUrl: 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf',
    legacy: true,
  },
  {
    id: 'lfm3-omni-2b',
    name: 'LFM3-VL-2B',
    shortName: 'LFM3-VL-2B',
    repoId: 'onnx-community/LFM3-VL-2B-ONNX',
    dtype: 'q4f16',
    sizeLabel: '1,24 Go',
    vramLabel: '~1,8 Go VRAM',
    contextLabel: '3 072 tokens avec image',
    isVision: true,
    description: 'Analyse locale des images. Chargé uniquement pour les demandes visuelles.',
  },

]

export const DEFAULT_MODEL_ID = LFM_MODELS[0].id
export const VISION_MODEL_ID = 'lfm3-omni-2b'

export function modelForRequest(hasImages: boolean, textModelId = DEFAULT_MODEL_ID): string {
  return hasImages ? VISION_MODEL_ID : textModelId
}

export function getModelSpec(modelId: string): LfmModelSpec {
  return LFM_MODELS.find((m) => m.id === modelId || m.repoId === modelId) ?? LFM_MODELS[0]
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
}

export type WorkerRequest =
  | { type: 'check'; modelId?: string; modelIds?: string[] }
  | { type: 'load'; modelId: string; file?: File; settings?: ModelSettings }
  | { type: 'generate'; requestId: number; modelId: string; messages: ChatTurn[]; enableThinking: boolean; allowTools: boolean; settings?: ModelSettings; webEvidence?: { instructions: string; blocks: string[] } }
  | { type: 'interrupt'; requestId: number }
  | { type: 'delete'; modelId: string }

export type WorkerResponse = (
  | { type: 'cache-status'; cachedMap: Record<string, boolean>; loadedModelId: string | null; webgpu: boolean }
  | { type: 'load-progress'; modelId: string; phase: 'download' | 'import' | 'warmup'; progress: number; loaded?: number; total?: number }
  | { type: 'ready'; modelId: string }
  | { type: 'prefill'; done: number; total: number }
  | { type: 'web-evidence-limit'; sourceCount: number }
  | { type: 'text'; text: string }
  | { type: 'done'; text?: string; tokens: number; tokensPerSecond: number; promptTokens: number; droppedTurns: number; metrics?: GenerationMetrics }
  | { type: 'deleted'; modelId: string }
  | { type: 'error'; scope: 'load' | 'generate' | 'delete'; message: string }
) & { requestId?: number }
