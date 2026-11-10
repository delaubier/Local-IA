import { DEFAULT_MODEL_ID, getModelSpec, LFM_MODELS } from '../llm-protocol'
import { GGUF_FILE } from './wllamaSettings'

const DIRECTORY = 'localai-gguf-v1'
const MARKER = 'complete.json'
async function directory(modelId?: string) {
  const root = await navigator.storage.getDirectory()
  const base = await root.getDirectoryHandle(DIRECTORY, { create: true })
  if (modelId && modelId !== DEFAULT_MODEL_ID) {
    if (!/^custom-[a-z0-9-]+$/.test(modelId) && !LFM_MODELS.some(model => model.id === modelId && model.ggufFile)) throw new Error('Identifiant de modèle invalide.')
    return base.getDirectoryHandle(modelId, { create: true })
  }
  return base
}
function details(modelId?: string) {
  const custom = modelId?.startsWith('custom-') ?? false
  const spec = getModelSpec(modelId ?? DEFAULT_MODEL_ID)
  return { custom, name: custom ? GGUF_FILE : spec.ggufFile ?? GGUF_FILE, bytes: custom ? 0 : spec.ggufBytes ?? 0, url: spec.ggufUrl }
}
export async function cachedGguf(modelId?: string): Promise<File | null> {
  try {
    const dir = await directory(modelId)
    const marker = JSON.parse(await (await (await dir.getFileHandle(MARKER)).getFile()).text())
    const { name, bytes } = details(modelId)
    const file = await (await dir.getFileHandle(name)).getFile()
    const expected = bytes || marker.bytes
    return marker.name === name && expected > 0 && marker.bytes === expected && file.size === expected ? file : null
  } catch { return null }
}
export async function saveGguf(file: File | undefined, onProgress: (loaded: number, total: number) => void, modelId?: string): Promise<File> {
  const { custom, name, bytes, url } = details(modelId)
  if (!file) {
    const cached = await cachedGguf(modelId)
    if (cached) { onProgress(cached.size, cached.size); return cached }
    if (custom) throw new Error('Importez le fichier GGUF de ce modèle avant de l’utiliser.')
  }
  if (file && ((!custom && bytes > 0 && file.size !== bytes) || file.size < 4 || await file.slice(0, 4).text() !== 'GGUF')) {
    throw new Error(custom ? 'Choisissez un fichier GGUF valide.' : `Choisissez le fichier ${name}.`)
  }
  const response = file ? null : await fetch(url!)
  if (response && (!response.ok || !response.body)) throw new Error(`Téléchargement du modèle impossible (HTTP ${response.status}).`)
  const expectedBytes = (file?.size ?? bytes) || Number(response?.headers.get('content-length'))
  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) throw new Error('La taille du modèle est inconnue. Réessayez ou importez un fichier GGUF.')
  const dir = await directory(modelId)
  await dir.removeEntry(MARKER).catch(() => {})
  const source = file?.stream() ?? response!.body!
  const handle = await dir.getFileHandle(name, { create: true })
  const writer = await handle.createWritable()
  const reader = source.getReader()
  let loaded = 0
  let lastUpdate = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.byteLength
      if (loaded > expectedBytes) throw new Error('Le fichier reçu ne correspond pas au modèle attendu.')
      await writer.write(value as FileSystemWriteChunkType)
      if (performance.now() - lastUpdate > 100) { onProgress(loaded, expectedBytes); lastUpdate = performance.now() }
    }
    if (loaded !== expectedBytes) throw new Error('Téléchargement incomplet. Réessayez ou importez votre fichier GGUF.')
    await writer.close()
    const stored = await handle.getFile()
    if (await stored.slice(0, 4).text() !== 'GGUF') throw new Error('Le fichier reçu n’est pas un GGUF valide.')
    const metadata = await (await dir.getFileHandle(MARKER, { create: true })).createWritable()
    await metadata.write(JSON.stringify({ name, bytes: loaded }))
    await metadata.close()
    onProgress(loaded, expectedBytes)
    return stored
  } catch (error) {
    await reader.cancel().catch(() => {})
    await writer.abort().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}
export async function deleteGguf(modelId?: string) {
  const dir = await directory(modelId)
  await dir.removeEntry(MARKER).catch(() => {})
  await dir.removeEntry(details(modelId).name).catch(() => {})
}
