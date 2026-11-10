import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('wllama requires explicit acquisition, counts before streaming, preserves native thinking and scopes cancellation', async () => {
  const events = []
  const state = { loads: 0, downloads: 0, cached: false, calls: [], loadOptions: [], hold: false }
  const saved = Object.fromEntries(['navigator', 'self', 'crossOriginIsolated'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const suspending = Object.getOwnPropertyDescriptor(WebAssembly, 'Suspending')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: {} } })
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true })
  Object.defineProperty(WebAssembly, 'Suspending', { configurable: true, value: () => {} })
  globalThis.self = { location: { origin: 'http://localhost' }, postMessage: message => events.push(message) }
  globalThis.__wllamaTest = state
  const compiled = await build({ entryPoints: ['src/worker.ts'], bundle: true, platform: 'browser', format: 'esm', write: false,
    plugins: [{ name: 'wllama-fixture', setup(builder) {
      builder.onResolve({ filter: /vendor\/generated\/wllama\.js$|\/ggufStore$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.includes('ggufStore') ? `
        export async function cachedGguf(){ return globalThis.__wllamaTest.cached ? {} : null; }
        export async function saveGguf(){ globalThis.__wllamaTest.downloads++;globalThis.__wllamaTest.cached=true;return {}; }
        export async function deleteGguf(){ globalThis.__wllamaTest.cached=false; }
      ` : `
        export class Wllama {
          loaded=false;
          setCompat(value){ if(value!==null) throw Error('Remote code enabled'); }
          isModelLoaded(){ return this.loaded; }
          async loadModel(files,options){globalThis.__wllamaTest.loads++;globalThis.__wllamaTest.loadOptions.push(options);this.loaded=true;}
          getLoadedContextInfo(){return {n_ctx:8192,n_vocab:128000,n_layer:24,metadata:{'general.architecture':'lfm3','general.file_type':'7'}};}
          async exit(){this.loaded=false;}
          async createChatCompletion(options){
            const s=globalThis.__wllamaTest;s.calls.push(options);
            if(options.max_tokens===1) return {usage:{prompt_tokens:options.messages.filter(m=>m.role==='user').length>1 || options.messages.at(-1).content.includes('SECOND_SOURCE') ? 5000 : 100}};
            if(s.hold) await new Promise((resolve,reject)=>options.abortSignal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
            if(options.chat_template_kwargs.enable_thinking) options.onData({choices:[{delta:{reasoning_content:'Calcul de test.'}}]});
            options.onData({choices:[{delta:{content:'40 %'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:3},timings:{predicted_n:3,predicted_per_second:30}});
          }
        }
      ` }))
    } }],
  })
  const waitFor = async predicate => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(predicate(), 'Expected worker event')
  }
  const request = (requestId, extra = {}) => self.onmessage({ data: { type: 'generate', requestId, modelId: 'lfm3-text-1.7b-q8', messages: [{ role: 'user', content: 'Question' }], allowTools: false, enableThinking: false, ...extra } })
  try {
    await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
    request(1)
    await waitFor(() => events.some(event => event.type === 'error'))
    assert.match(events.at(-1).message, /Téléchargez/)
    assert.equal(state.downloads, 0)
    self.onmessage({ data: { type: 'load', modelId: 'lfm3-text-1.7b-q8' } })
    await waitFor(() => events.some(event => event.type === 'ready'))
    assert.equal(state.downloads, 1)
    assert.equal(state.loads, 1)
    request(2, { enableThinking: true, messages: [
      { role: 'system', content: 'Test' }, { role: 'user', content: 'Ancien sujet' }, { role: 'assistant', content: 'Ancienne réponse' }, { role: 'user', content: 'Question actuelle' },
    ] })
    await waitFor(() => events.some(event => event.type === 'done' && event.requestId === 2))
    const done = events.find(event => event.type === 'done' && event.requestId === 2)
    assert.equal(done.text, '<think>Calcul de test.</think>40 %')
    assert.equal(done.droppedTurns, 1)
    assert.equal(done.metrics.tokens, 3)
    assert.equal(done.metrics.promptTokens, 100)
    assert.equal(done.metrics.tokensPerSecond, 30)
    assert.equal(done.metrics.finishReason, 'stop')
    assert.ok(done.metrics.elapsedMs >= done.metrics.firstTokenMs)
    assert.equal(state.downloads, 1)
    assert.deepEqual(state.calls.map(call => call.max_tokens), [1, 1, 4096])
    assert.equal(state.calls.at(-1).chat_template_kwargs.enable_thinking, true)
    for (const call of state.calls) {
      assert.ok(call.messages.every(message => message.role !== 'system'))
      assert.equal(call.temperature, 0.1)
      assert.equal(call.top_k, 50)
      assert.equal(call.penalty_repeat, 1.1)
    }
    state.hold = true
    request(3)
    await waitFor(() => state.calls.at(-1)?.stream === true && state.calls.length === 5)
    self.onmessage({ data: { type: 'interrupt', requestId: 2 } })
    assert.equal(state.calls.at(-1).abortSignal.aborted, false)
    self.onmessage({ data: { type: 'interrupt', requestId: 3 } })
    await waitFor(() => events.some(event => event.type === 'done' && event.requestId === 3))
    assert.equal(state.calls.at(-1).abortSignal.aborted, true)
    assert.equal(state.calls.at(-1).chat_template_kwargs.enable_thinking, false)
    assert.equal(state.calls.at(-1).temperature, 0.1)
    assert.equal(state.calls.at(-1).top_k, 50)
    assert.equal(state.calls.at(-1).penalty_repeat, 1.1)
    assert.ok(state.calls.at(-1).messages.every(message => message.role !== 'system'))
    assert.equal(events.filter(event => event.type === 'done' && event.requestId === 3).length, 1)
    assert.equal(events.find(event => event.type === 'done' && event.requestId === 3).metrics.finishReason, 'interrupted')
    state.hold = false
    const settings = { contextLength: 4096, maxOutputTokens: 512, systemPrompt: 'Only this explicit instruction.', temperature: .25, topK: 42, topP: .9, minP: .05, repeatPenalty: 1.2, presencePenalty: .2, frequencyPenalty: .3, seed: 123, reasoningBudget: 128, threads: 2, batchSize: 128, microBatchSize: 64, stopSequences: 'STOP\nEND' }
    request(4, { settings, messages: [{ role: 'system', content: 'Hidden instruction' }, { role: 'user', content: 'Question' }] })
    await waitFor(() => events.some(event => event.type === 'done' && event.requestId === 4))
    assert.equal(state.loads, 2)
    assert.equal(state.loadOptions.at(-1).n_ctx, 4096)
    assert.equal(state.loadOptions.at(-1).reasoning_budget_tokens, 128)
    assert.equal(state.loadOptions.at(-1).n_threads, 2)
    const applied = state.calls.at(-1)
    assert.equal(applied.max_tokens, 512)
    assert.equal(applied.temperature, .25)
    assert.equal(applied.top_k, 42)
    assert.equal(applied.top_p, .9)
    assert.equal(applied.min_p, .05)
    assert.equal(applied.penalty_repeat, 1.2)
    assert.equal(applied.presence_penalty, .2)
    assert.equal(applied.frequency_penalty, .3)
    assert.equal(applied.seed, 123)
    assert.deepEqual(applied.stop, ['STOP', 'END'])
    assert.deepEqual(applied.messages.filter(message => message.role === 'system'), [{ role: 'system', content: settings.systemPrompt }])
    request(5, { settings: { ...settings, temperature: .3 } })
    await waitFor(() => events.some(event => event.type === 'done' && event.requestId === 5))
    assert.equal(state.loads, 2, 'Sampling changes do not reload the model')
    request(6, { settings: { ...settings, contextLength: 2048 } })
    await waitFor(() => events.some(event => event.type === 'done' && event.requestId === 6))
    assert.equal(state.loads, 3, 'Context changes rebuild the native context')
    const webEvidence = { instructions: 'Web evidence', blocks: ['FIRST_SOURCE', 'SECOND_SOURCE'] }
    request(7, { webEvidence, messages: [{ role: 'user', content: 'Web evidence\n\nFIRST_SOURCE\n\nSECOND_SOURCE\n\nQuestion précise ?' }] })
    await waitFor(() => events.some(event => event.type === 'done' && event.requestId === 7))
    const researchEvents = events.filter(event => event.requestId === 7)
    assert.equal(researchEvents[0].type, 'web-evidence-limit')
    assert.equal(researchEvents[0].sourceCount, 1)
    assert.equal(state.calls.at(-1).messages.at(-1).content, 'Web evidence\n\nFIRST_SOURCE\n\nQuestion précise ?')
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key] }
    if(suspending) Object.defineProperty(WebAssembly,'Suspending',suspending); else delete WebAssembly.Suspending
    delete globalThis.__wllamaTest
  }
})
