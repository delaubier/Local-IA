import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function moduleAt(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
test('saved model preferences recover from invalid values and keep output and thinking inside context', async () => {
  const { normalizeModelSettings, settingsForModel, readModelSettings, readImportedModels } = await moduleAt('src/utils/modelSettings.ts')
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const items = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => items.get(key) } })
  try {
    const invalid = normalizeModelSettings({ contextLength: 1024, maxOutputTokens: 9000, reasoningBudget: 9999, temperature: NaN, topP: -1, minP: 3, threads: -7, batchSize: 32, microBatchSize: 500 })
    assert.equal(invalid.maxOutputTokens, 896)
    assert.equal(invalid.reasoningBudget, 895)
    assert.equal(invalid.temperature, .1)
    assert.equal(invalid.topP, .01)
    assert.equal(invalid.minP, 1)
    assert.equal(invalid.threads, 1)
    assert.equal(invalid.microBatchSize, 32)
    assert.equal(normalizeModelSettings({ reasoningBudget: -1 }).reasoningBudget, -1)
    assert.equal(normalizeModelSettings().systemPrompt, '')
    assert.equal(settingsForModel('qwen3-text-1.7b-q8').temperature, .7)
    assert.equal(settingsForModel('qwen3-text-1.7b-q8').presencePenalty, 1.5)
    assert.equal(settingsForModel('qwen3-text-1.7b-q8', { temperature: .4 }).temperature, .4)
    assert.equal(settingsForModel('lfm3-text-1.7b-q8').temperature, .1)
    items.set('localaiModelSettings', 'invalid JSON')
    assert.deepEqual(readModelSettings(), {})
    items.set('localaiModelSettings', JSON.stringify({ model: { topK: 75 } }))
    assert.equal(readModelSettings().model.topK, 75)
    items.set('localaiImportedModels', JSON.stringify([{ id: 'custom-one', name: 'Mine', bytes: 10 }, { id: '../unsafe', name: 'Bad', bytes: 10 }]))
    assert.deepEqual(readImportedModels().map(model => model.id), ['custom-one'])
  } finally { if (saved) Object.defineProperty(globalThis, 'localStorage', saved); else delete globalThis.localStorage }
})

test('download suggestion uses system memory and keeps the general-purpose default when memory is unknown', async () => {
  const { recommendTextModel, LIGHT_MODEL_ID } = await moduleAt('src/utils/modelRecommendation.ts')
  assert.equal(recommendTextModel(16), 'lfm3-text-1.7b-q8')
  assert.equal(recommendTextModel(4), LIGHT_MODEL_ID)
  assert.equal(recommendTextModel(), 'lfm3-text-1.7b-q8')
})

test('interface follows Chrome by default and respects explicit language choice', async () => {
  const { resolveLanguage, interfaceLocale, tr } = await moduleAt('src/utils/i18n.ts')
  const keys = ['chrome', 'navigator', 'localStorage']
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let preference = null
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => preference } })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { i18n: { getUILanguage: () => 'fr-CA' } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'en-US' } })
  try {
    assert.equal(interfaceLocale(), 'fr')
    assert.equal(resolveLanguage('auto', 'de-DE'), 'en')
    preference = 'en'
    assert.equal(tr('Paramètres'), 'Settings')
    preference = 'fr'
    assert.equal(tr('Paramètres'), 'Paramètres')
    delete globalThis.chrome
    preference = 'auto'
    assert.equal(interfaceLocale(), 'en')
  } finally { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } }
})
