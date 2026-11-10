import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('the faster balanced dictation default migrates once and keeps later manual choices', async () => {
  const result = await build({ entryPoints: ['src/utils/audioModels.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
  const { readAudioModel, DEFAULT_AUDIO_MODEL } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map([['localaiAudioModel', 'onnx-community/whisper-small']])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } })
  try {
    assert.equal(readAudioModel(), DEFAULT_AUDIO_MODEL)
    assert.equal(values.get('localaiAudioModel'), DEFAULT_AUDIO_MODEL)
    values.set('localaiAudioModel', 'onnx-community/whisper-small')
    assert.equal(readAudioModel(), 'onnx-community/whisper-small')
  } finally { if (saved) Object.defineProperty(globalThis, 'localStorage', saved); else delete globalThis.localStorage }
})
