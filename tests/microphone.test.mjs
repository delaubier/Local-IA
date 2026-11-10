import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('microphone meter reads captured sound and releases all resources on cancel, startup failure and recorder error', async () => {
  const keys = ['navigator', 'MediaRecorder', 'AudioContext']
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let stops = 0, closes = 0, connections = 0, sound = 0, fail = false, activeRecorder, acquire
  const stream = { getTracks: () => [{ stop: () => stops++ }] }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => acquire ? new Promise(resolve => { acquire = resolve }) : Promise.resolve(stream) } } })
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true }
    state = 'inactive'
    constructor() { if (fail) throw Error('Recorder unavailable'); activeRecorder = this }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.onstop?.() }
  }
  globalThis.AudioContext = class {
    sampleRate = 48000
    createAnalyser() { return { frequencyBinCount: 256, fftSize: 512, getByteFrequencyData: bins => bins.fill(sound), getFloatTimeDomainData: samples => samples.fill(sound / 255) } }
    createMediaStreamSource() { return { connect: () => connections++, disconnect: () => {} } }
    async resume() {}
    async close() { closes++ }
  }
  try {
    const result = await build({ entryPoints: ['src/utils/localAudio.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
    const { LocalMicRecorder } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
    const recorder = new LocalMicRecorder()
    await recorder.start()
    assert.equal(recorder.isRecording, true)
    assert.deepEqual(recorder.frequencyLevels(), Array(24).fill(0))
    assert.equal(recorder.waveformLevel(), 0)
    sound = 255
    assert.ok(recorder.frequencyLevels().every(value => value > .9))
    assert.equal(recorder.waveformLevel(), 1)
    assert.equal(connections, 1, 'The microphone connects only to its analyser')
    recorder.cancel()
    assert.equal(recorder.isRecording, false)
    assert.equal(stops, 1)
    assert.equal(closes, 1)
    fail = true
    await assert.rejects(recorder.start(), /Recorder unavailable/)
    assert.equal(stops, 2, 'Recorder startup failure releases the acquired stream')
    fail = false
    await recorder.start()
    activeRecorder.stop = () => activeRecorder.onerror()
    await assert.rejects(recorder.stop(), /Erreur/)
    assert.equal(stops, 3)
    assert.equal(closes, 2)
    acquire = true
    const pending = recorder.start()
    recorder.cancel()
    acquire(stream)
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(stops, 4, 'Cancel while permission is pending releases late streams')
  } finally { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } }
})
