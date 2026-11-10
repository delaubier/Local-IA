import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('GGUF cache commits only a complete file, reuses it offline, and accepts a local import without fetching', async () => {
  function memoryDirectory() {
    const files = new Map(), folders = new Map()
    return {
    async getDirectoryHandle(name) { if (!folders.has(name)) folders.set(name, memoryDirectory()); return folders.get(name) },
    async removeEntry(name) { files.delete(name) },
    async getFileHandle(name, options) {
      if (!files.has(name)) { if (!options?.create) throw Error('Not found'); files.set(name, new Blob()) }
      return {
        async getFile() { return new File([files.get(name)], name) },
        async createWritable() {
          const chunks = []
          return { async write(data) { chunks.push(data) }, async close() { files.set(name, new Blob(chunks)) }, async abort() {} }
        },
      }
    },
    }
  }
  const directory = memoryDirectory()
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => directory } } })
  let fetches = 0
  let body = 'GGUF1234'
  globalThis.fetch = async () => { fetches++; return new Response(body) }
  const compiled = await build({ entryPoints: ['src/utils/ggufStore.ts'], bundle: true, platform: 'browser', format: 'esm', write: false,
    plugins: [{ name: 'tiny-file-fixture', setup(builder) {
      builder.onResolve({ filter: /wllamaSettings$/ }, () => ({ path: 'settings', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const GGUF_BYTES=8;export const GGUF_FILE='fixture.gguf';export const GGUF_URL='https://example.test/fixture.gguf';` }))
    } }],
  })
  try {
    const { cachedGguf, saveGguf, deleteGguf } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
    assert.equal(await cachedGguf(), null)
    const progress = []
    assert.equal((await saveGguf(undefined, (loaded, total) => progress.push([loaded, total]))).size, 8)
    assert.deepEqual(progress.at(-1), [8, 8])
    assert.equal((await cachedGguf()).size, 8)
    await saveGguf(undefined, () => {})
    assert.equal(fetches, 1)
    await assert.rejects(saveGguf(new File(['BADF1234'], 'wrong.gguf'), () => {}), /Choisissez/)
    assert.equal((await cachedGguf()).size, 8)
    await deleteGguf()
    body = 'GGUF12'
    await assert.rejects(saveGguf(undefined, () => {}), /incomplet/)
    assert.equal(await cachedGguf(), null)
    const before = fetches
    await saveGguf(new File(['GGUF1234'], 'local.gguf'), () => {})
    assert.equal(fetches, before)
    assert.equal(await (await cachedGguf()).text(), 'GGUF1234')
    await saveGguf(new File(['GGUF-custom'], 'other.gguf'), () => {}, 'custom-one')
    await saveGguf(new File(['GGUF-other'], 'third.gguf'), () => {}, 'custom-two')
    assert.equal(await (await cachedGguf('custom-one')).text(), 'GGUF-custom')
    assert.equal(await (await cachedGguf('custom-two')).text(), 'GGUF-other')
    assert.equal(await (await cachedGguf()).text(), 'GGUF1234')
    await assert.rejects(saveGguf(undefined, () => {}, 'custom-missing'), /Importez/)
    await assert.rejects(saveGguf(new File(['BADF-data'], 'bad.gguf'), () => {}, 'custom-one'), /GGUF valide/)
    assert.equal(await (await cachedGguf('custom-one')).text(), 'GGUF-custom')
    await deleteGguf('custom-one')
    assert.equal(await cachedGguf('custom-one'), null)
    assert.equal(await (await cachedGguf('custom-two')).text(), 'GGUF-other')
    assert.equal(fetches, before)
    await deleteGguf()
    assert.equal(await cachedGguf(), null)
  } finally {
    globalThis.fetch = originalFetch
    if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator
  }
})
