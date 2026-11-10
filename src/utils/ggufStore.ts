import { GGUF_BYTES, GGUF_FILE, GGUF_URL } from './wllamaSettings'

const DIRECTORY = 'localai-gguf-v1'
const MARKER = 'complete.json'
async function directory(modelId?: string) {
  const root = await navigator.storage.getDirectory()
  const base = await root.getDirectoryHandle(DIRECTORY, { create: true })
  if (modelId?.startsWith('custom-')) {
    if (!/^custom-[a-z0-9-]+$/.test(modelId)) throw new Error('Identifiant de modèle invalide.')
    return base.getDirectoryHandle(modelId, { create: true })
  }
  return base
}
export async function cachedGguf(modelId?: string): Promise<File | null> {
  try {
    const dir = await directory(modelId)
    const marker = JSON.parse(await (await (await dir.getFileHandle(MARKER)).getFile()).text())
    const file = await (await dir.getFileHandle(GGUF_FILE)).getFile()
    const expected = modelId?.startsWith('custom-') ? marker.bytes : GGUF_BYTES
    return marker.name === GGUF_FILE && expected > 0 && marker.bytes === expected && file.size === expected ? file : null
  } catch { return null }
}
export async function saveGguf(file: File | undefined, onProgress: (loaded: number, total: number) => void, modelId?: string): Promise<File> {
  const custom = modelId?.startsWith('custom-')
  if (!file) {
    const cached = await cachedGguf(modelId)
    if (cached) { onProgress(cached.size, cached.size); return cached }
    if (custom) throw new Error('Importez le fichier GGUF de ce modèle avant de l’utiliser.')
  }
  if (file && ((!custom && file.size !== GGUF_BYTES) || file.size < 4 || await file.slice(0, 4).text() !== 'GGUF')) {
    throw new Error(custom ? 'Choisissez un fichier GGUF valide.' : `Choisissez le fichier ${GGUF_FILE} (${(GGUF_BYTES / 1e9).toFixed(2)} Go).`)
  }
  const expectedBytes = custom ? file!.size : GGUF_BYTES
  const dir = await directory(modelId)
  await dir.removeEntry(MARKER).catch(() => {})
  const response = file ? null : await fetch(GGUF_URL)
  if (response && (!response.ok || !response.body)) throw new Error(`Téléchargement du modèle impossible (HTTP ${response.status}).`)
  const source = file?.stream() ?? response!.body!
  const handle = await dir.getFileHandle(GGUF_FILE, { create: true })
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
    await metadata.write(JSON.stringify({ name: GGUF_FILE, bytes: loaded }))
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
  await dir.removeEntry(GGUF_FILE).catch(() => {})
}
