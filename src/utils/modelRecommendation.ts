import { DEFAULT_MODEL_ID } from '../llm-protocol'

export const LIGHT_MODEL_ID = 'qwen35-text-0.8b-q8'

/** Coarse download suggestion, not a guarantee that WebGPU can load the model. */
export function recommendTextModel(deviceMemory?: number) {
  if (deviceMemory && deviceMemory < 8) return LIGHT_MODEL_ID
  return DEFAULT_MODEL_ID
}
