import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('Whisper is checked without downloading, requires explicit loading, and retries a failed load', async (t) => {
  t.mock.method(console, 'error', () => {})
  const outputs = []
  const state = { loads: 0, cached: false, fail: true, languages: [], modelIds: [], detected: 'en' }
  globalThis.__audioSetup = state
  globalThis.self = { location: { href: 'http://localhost/audioWorker.js' }, postMessage: (message) => outputs.push(message) }
  const result = await build({ entryPoints: ['src/audioWorker.ts'], bundle: true, platform: 'browser', format: 'esm', write: false,
    plugins: [{ name: 'model-fixture', setup(builder) {
      builder.onResolve({ filter: /^@huggingface\/transformers$|\?url$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.includes('?url') ? 'export default "/runtime"' : `
        export const env = { backends: { onnx: { wasm: {} } } };
        export class Tensor { constructor(type,data,dims){this.data=data;this.dims=dims} dispose(){} }
        export const ModelRegistry = { is_cached: async () => globalThis.__audioSetup.cached,
          get_model_files: async () => ['encoder', 'decoder'], get_file_metadata: async () => ({size: 100}) };
        export async function pipeline(_task, _id, options) {
          const state = globalThis.__audioSetup; state.loads++;
          state.modelIds.push(_id);
          if (state.fail) { state.fail = false; throw new Error('download failed') }
          options.progress_callback({status:'progress',file:'encoder',loaded:100,total:100});
          options.progress_callback({status:'progress',file:'decoder',loaded:20,total:100});
          options.progress_callback({status:'done',file:'decoder'});
          state.cached = true;
          const transcriber = async (audio, options) => {state.languages.push(options);return {text:options.language==='en'?'Good morning.':'Bonjour.'}};
          transcriber.dispose = async () => {};
          transcriber.processor = async () => ({});
          transcriber.model = Object.assign(async () => ({logits:{dims:[1,1,4],data:new Float32Array([100,0,state.detected==='en'?10:1,state.detected==='fr'?10:1])}}),{generation_config:{decoder_start_token_id:1,lang_to_id:{'<|en|>':2,'<|fr|>':3}}});
          return transcriber;
        }` }))
    } }],
  })
  try {
    await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
    const send = (data) => self.onmessage({ data })
    await send({ type: 'check' })
    assert.equal(outputs.at(-1).cached, false)
    assert.equal(state.loads, 0)
    await send({ type: 'transcribe', source: 'mic', audio: new Float32Array(20) })
    assert.equal(outputs.at(-1).type, 'asr-error')
    assert.equal(state.loads, 0, 'Recording must never initiate a hidden download')
    await send({ type: 'load' })
    assert.equal(outputs.at(-1).type, 'asr-error')
    outputs.length = 0
    await send({ type: 'load' })
    assert.equal(outputs.at(-1).type, 'asr-ready')
    const progress = outputs.filter((o) => o.type === 'asr-progress').map((o) => o.progress)
    assert.deepEqual(progress, [...progress].sort((a, b) => a - b))
    assert.ok(progress.every((p) => p < 1))
    await send({ type: 'transcribe', source: 'mic', language: 'french', audio: new Float32Array(20) })
    assert.equal(outputs.at(-1).text, 'Good morning.')
    assert.equal(state.languages.at(-1).language, 'en', 'Spoken English wins over a French hint or browser')
    assert.equal(state.languages.at(-1).task, 'transcribe')
    state.detected = 'fr'
    await send({ type: 'transcribe', source: 'mic', audio: new Float32Array(20) })
    assert.equal(outputs.at(-1).text, 'Bonjour.')
    assert.equal(state.loads, 2)
    await send({ type: 'load', modelId: 'onnx-community/whisper-tiny' })
    await send({ type: 'transcribe', source: 'mic', modelId: 'onnx-community/whisper-tiny', audio: new Float32Array(20) })
    assert.equal(state.modelIds.at(-1), 'onnx-community/whisper-tiny')
    assert.equal(outputs.at(-1).text, 'Bonjour.')
  } finally { delete globalThis.self; delete globalThis.__audioSetup }
})
