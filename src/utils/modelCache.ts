import { DEFAULT_MODEL_ID, getModelSpec, LFM_MODELS } from '../llm-protocol'
import { GGUF_FILE } from './wllamaSettings'
import { AUDIO_MODELS, importedAudioDtype } from './audioModels'
import { POCKET_SPEECH_CACHE } from './neuralSpeech'

export async function cachedAudioBytes(modelId: string): Promise<number | null> {
  if (!(await caches.keys()).includes('transformers-cache')) return null
  const cache = await caches.open('transformers-cache')
  let bytes = 0
  for (const request of await cache.keys()) {
    if (!decodeURIComponent(new URL(request.url).pathname).startsWith(`/${modelId}/`)) continue
    const response = await cache.match(request)
    if (!response) continue
    const length = Number(response.headers.get('Content-Length'))
    if (length > 0 && !response.headers.get('Content-Encoding')) bytes += length
    else bytes += (await response.blob()).size
  }
  return bytes || null
}

async function removeEntry(directory: FileSystemDirectoryHandle, name: string, recursive = false) {
  try { await directory.removeEntry(name, { recursive }) } catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error }
}
/** Only this extension's model storage. Never touches conversations or arbitrary OPFS entries. */
export async function clearModelFiles(modelId?: string) {
  if (!modelId && typeof caches !== 'undefined') await caches.delete(POCKET_SPEECH_CACHE)
  const audio = AUDIO_MODELS.some(model => model.id === modelId) || !!importedAudioDtype(modelId)
  if (modelId && !LFM_MODELS.some(model => model.id === modelId) && !audio && !/^custom-[a-z0-9-]+$/.test(modelId)) throw new Error('Identifiant de modèle invalide.')
  const isGguf = !modelId || LFM_MODELS.some(model => model.id === modelId && model.ggufFile) || modelId.startsWith('custom-')
  if (isGguf) {
    const root = await navigator.storage.getDirectory()
    if (!modelId) await removeEntry(root, 'localai-gguf-v1', true)
    else {
      let directory: FileSystemDirectoryHandle | undefined
      try { directory = await root.getDirectoryHandle('localai-gguf-v1') } catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error }
      if (directory) {
        if (modelId !== DEFAULT_MODEL_ID) {
          await removeEntry(directory, modelId, true)
        } else { await removeEntry(directory, 'complete.json'); await removeEntry(directory, GGUF_FILE) }
      }
    }
  }
  if (typeof caches !== 'undefined' && (await caches.keys()).includes('transformers-cache')) {
    if (!modelId) { if (!await caches.delete('transformers-cache')) throw new Error('Impossible de supprimer le cache des modèles.') }
    else if (!isGguf) {
      const repo = audio ? modelId : getModelSpec(modelId).repoId
      const cache = await caches.open('transformers-cache')
      for (const request of await cache.keys()) {
        const path = decodeURIComponent(new URL(request.url).pathname)
        if (path.startsWith(`/${repo}/`)) {
          if (!await cache.delete(request)) throw new Error('Impossible de supprimer un fichier du modèle.')
        }
      }
    }
  }
}
