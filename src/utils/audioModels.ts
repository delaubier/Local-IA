export const PARAKEET_MODEL_ID = 'ysdede/parakeet-tdt-0.6b-v3-onnx'
export const AUDIO_MODELS = [
  { id: 'onnx-community/whisper-tiny', name: 'Whisper Tiny', description: 'Très léger · multilingue' },
  { id: 'onnx-community/whisper-base', name: 'Whisper Base', description: 'Équilibré · multilingue' },
  { id: 'onnx-community/whisper-small', name: 'Whisper Small', description: 'Plus précis · multilingue' },
  { id: PARAKEET_MODEL_ID, name: 'Parakeet v3', description: '25 langues · CPU · 670 Mo' },
] as const
export const DEFAULT_AUDIO_MODEL = 'onnx-community/whisper-base'
export type ImportedAudioModel = { id: string; name: string }
export type DictationLanguage = 'auto' | 'fr' | 'en'
export type DictationBackend = 'auto' | 'wasm' | 'webgpu'
export type AudioDevice = Exclude<DictationBackend, 'auto'>
export function readDictationBackend(): DictationBackend {
  const value = localStorage.getItem('localaiDictationBackend')
  return value === 'wasm' || value === 'webgpu' ? value : 'auto'
}
export function readDictationLanguage(): DictationLanguage {
  const value = localStorage.getItem('localaiDictationLanguage')
  return value === 'fr' || value === 'en' ? value : 'auto'
}

export function importedAudioDtype(id?: string): 'q8' | 'fp32' | undefined {
  return id?.match(/^localai-imports\/whisper-[a-f0-9-]{36}-(q8|fp32)$/)?.[1] as 'q8' | 'fp32' | undefined
}

export function readImportedAudioModels(): ImportedAudioModel[] {
  try {
    const saved = JSON.parse(localStorage.getItem('localaiImportedAudioModels') ?? '[]') as ImportedAudioModel[]
    return saved.filter(model => model && importedAudioDtype(model.id) && typeof model.name === 'string')
  } catch { return [] }
}

export function audioModelId(id?: string) {
  return AUDIO_MODELS.some(model => model.id === id) || importedAudioDtype(id) ? id! : DEFAULT_AUDIO_MODEL
}
export function readAudioModel() {
  const stored = localStorage.getItem('localaiAudioModel')
  if (!localStorage.getItem('localaiWhisperBaseDefaultV1')) {
    localStorage.setItem('localaiWhisperBaseDefaultV1', 'true')
    if (stored === 'onnx-community/whisper-small') {
      localStorage.setItem('localaiAudioModel', DEFAULT_AUDIO_MODEL)
      return DEFAULT_AUDIO_MODEL
    }
  }
  const id = audioModelId(stored ?? undefined)
  return !importedAudioDtype(id) || readImportedAudioModels().some(model => model.id === id) ? id : DEFAULT_AUDIO_MODEL
}
