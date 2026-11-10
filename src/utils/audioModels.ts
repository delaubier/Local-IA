export const AUDIO_MODELS = [
  { id: 'onnx-community/whisper-tiny', name: 'Whisper Tiny', description: 'Très léger · multilingue' },
  { id: 'onnx-community/whisper-base', name: 'Whisper Base', description: 'Équilibré · multilingue' },
  { id: 'onnx-community/whisper-small', name: 'Whisper Small', description: 'Plus précis · multilingue' },
] as const
export const DEFAULT_AUDIO_MODEL = 'onnx-community/whisper-small'
export function audioModel(id?: string) { return AUDIO_MODELS.find(model => model.id === id) ?? AUDIO_MODELS[2] }
export function readAudioModel() { return audioModel(localStorage.getItem('localaiAudioModel') ?? undefined).id }
