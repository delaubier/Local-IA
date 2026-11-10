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
  | { type: 'load-progress'; modelId: string; phase: 'download' | 'warmup'; progress: number; loaded?: number; total?: number }
  | { type: 'ready'; modelId: string }
  | { type: 'prefill'; done: number; total: number }
  | { type: 'web-evidence-limit'; sourceCount: number }
  | { type: 'text'; text: string }
  | { type: 'done'; text?: string; tokens: number; tokensPerSecond: number; promptTokens: number; droppedTurns: number; metrics?: GenerationMetrics }
  | { type: 'deleted'; modelId: string }
  | { type: 'error'; scope: 'load' | 'generate' | 'delete'; message: string }
) & { requestId?: number }
