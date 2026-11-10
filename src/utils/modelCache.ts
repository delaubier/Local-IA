import { DEFAULT_MODEL_ID, getModelSpec, LFM_MODELS } from '../llm-protocol'
import { GGUF_FILE } from './wllamaSettings'
import { AUDIO_MODELS } from './audioModels'

async function removeEntry(directory: FileSystemDirectoryHandle, name: string, recursive = false) {
  try { await directory.removeEntry(name, { recursive }) } catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error }
}
/** Only this extension's model storage. Never touches conversations or arbitrary OPFS entries. */
export async function clearModelFiles(modelId?: string) {
  if (modelId && !LFM_MODELS.some(model => model.id === modelId) && !AUDIO_MODELS.some(model => model.id === modelId) && !/^custom-[a-z0-9-]+$/.test(modelId)) throw new Error('Identifiant de modèle invalide.')
  const isGguf = !modelId || modelId === DEFAULT_MODEL_ID || modelId.startsWith('custom-')
  if (isGguf) {
    const root = await navigator.storage.getDirectory()
    if (!modelId) await removeEntry(root, 'localai-gguf-v1', true)
    else {
      let directory: FileSystemDirectoryHandle | undefined
      try { directory = await root.getDirectoryHandle('localai-gguf-v1') } catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error }
      if (directory) {
        if (modelId.startsWith('custom-')) {
          if (!/^custom-[a-z0-9-]+$/.test(modelId)) throw new Error('Identifiant de modèle invalide.')
          await removeEntry(directory, modelId, true)
        } else { await removeEntry(directory, 'complete.json'); await removeEntry(directory, GGUF_FILE) }
      }
    }
  }
  if (typeof caches !== 'undefined' && (await caches.keys()).includes('transformers-cache')) {
    if (!modelId) { if (!await caches.delete('transformers-cache')) throw new Error('Impossible de supprimer le cache des modèles.') }
    else if (!isGguf) {
      const repo = modelId.startsWith('onnx-community/') ? modelId : getModelSpec(modelId).repoId
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
