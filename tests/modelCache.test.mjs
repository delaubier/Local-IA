import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('model deletion is scoped, works offline and preserves conversations and unrelated storage', async () => {
  const saved = Object.fromEntries(['navigator', 'caches', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const removed = [], cacheDeletes = []
  let fail = false
  const folder = path => ({ async getDirectoryHandle(name) { return folder(`${path}/${name}`) }, async removeEntry(name, options) { if (fail) throw new DOMException('Locked', 'InvalidStateError'); removed.push([`${path}/${name}`, options.recursive]) } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => folder('root') } } })
  const requests = ['https://huggingface.co/onnx-community/whisper-small/resolve/main/config.json','https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model_quantized.onnx','https://huggingface.co/unrelated/whisper-small/resolve/main/config.json'].map(url => new Request(url))
  globalThis.caches = { keys: async () => ['transformers-cache', 'other-cache'], delete: async name => { cacheDeletes.push(name); return true }, open: async () => ({ keys: async () => requests, delete: async request => {cacheDeletes.push(request.url);return true} }) }
  globalThis.fetch = () => { throw Error('Deletion must not download files') }
  try {
    const result = await build({ entryPoints: ['src/utils/modelCache.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
    const { clearModelFiles } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
    await clearModelFiles('onnx-community/whisper-small')
    assert.deepEqual(cacheDeletes, [requests[0].url])
    assert.deepEqual(removed, [])
    await clearModelFiles('custom-one')
    assert.deepEqual(removed.at(-1), ['root/localai-gguf-v1/custom-one', true])
    await clearModelFiles('lfm3-text-1.7b-q8')
    assert.equal(removed.at(-2)[0], 'root/localai-gguf-v1/complete.json')
    assert.ok(!removed.some(([path]) => path.includes('chatHistory')))
    await assert.rejects(clearModelFiles('custom-../unsafe'), /Identifiant/)
    await clearModelFiles()
    assert.deepEqual(removed.at(-1), ['root/localai-gguf-v1', true])
    assert.equal(cacheDeletes.at(-1), 'transformers-cache')
    assert.ok(!cacheDeletes.includes('other-cache'))
    fail = true
    await assert.rejects(clearModelFiles('custom-one'), /Locked/)
  } finally { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } }
})
