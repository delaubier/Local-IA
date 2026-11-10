import type { ImportedAudioModel } from './audioModels'

const metadata = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json']
const weights = (dtype: 'q8' | 'fp32') => {
  const suffix = dtype === 'q8' ? '_quantized' : ''
  return [`onnx/encoder_model${suffix}.onnx`, `onnx/decoder_model_merged${suffix}.onnx`]
}
const key = (id: string, path: string) => `https://huggingface.co/${id}/resolve/main/${path}`

export async function hasImportedAudioModel(id: string, dtype: 'q8' | 'fp32') {
  const cache = await caches.open('transformers-cache')
  const files = await Promise.all([...metadata, ...weights(dtype)].map(path => cache.match(key(id, path))))
  return files.every(Boolean)
}

export async function importAudioModel(files: File[]): Promise<ImportedAudioModel> {
  const folder = files[0]?.webkitRelativePath.split('/')[0]
  const entries = new Map(files.filter(file => file.size > 0).map(file => [file.webkitRelativePath.split('/').slice(1).join('/'), file]))
  const dtype = weights('q8').every(path => entries.has(path)) ? 'q8' : 'fp32'
  const modelFiles = weights(dtype)
  const required = [...metadata, ...modelFiles]
  if (!folder || !required.every(path => entries.has(path))) {
    throw new Error('Choisissez un dossier Whisper ONNX complet, avec ses fichiers JSON et les deux poids dans onnx/.')
  }
  const [config, generation] = await Promise.all(
    ['config.json', 'generation_config.json'].map(async path => JSON.parse(await entries.get(path)!.text())),
  )
  if (config?.model_type !== 'whisper' || !Number.isInteger(generation?.decoder_start_token_id) || !Object.keys(generation?.lang_to_id ?? {}).length) {
    throw new Error('Choisissez un modèle Whisper multilingue compatible.')
  }
  const id = `localai-imports/whisper-${crypto.randomUUID()}-${dtype}`
  const cache = await caches.open('transformers-cache')
  const saved: string[] = []
  try {
    for (const [path, file] of entries) {
      if (!required.includes(path) && !modelFiles.some(model => path.startsWith(`${model}_data`) && /^_data(?:_\d+)?$/.test(path.slice(model.length)))) continue
      const url = key(id, path)
      await cache.put(url, new Response(file, { headers: { 'Content-Length': String(file.size) } }))
      saved.push(url)
    }
  } catch (error) {
    await Promise.allSettled(saved.map(url => cache.delete(url)))
    throw error
  }
  return { id, name: folder }
}
