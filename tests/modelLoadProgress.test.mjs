import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/utils/modelLoadProgress.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const { ModelLoadProgress } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('Small config files cannot fill the ring before large model files arrive', () => {
  const tracker = new ModelLoadProgress([{ file: 'config', size: 10 }, { file: 'model', size: 990 }])
  assert.equal(tracker.update({ file: 'config', status: 'done' }), 0.009)
  assert.equal(tracker.update({ file: 'model', loaded: 495, total: 990 }), 0.4545)
  assert.equal(tracker.update({ file: 'model', status: 'done' }), 0.9)
  assert.equal(tracker.preparing(), 0.95)
  assert.equal(tracker.ready(), 1)
})

test('Parallel, repeated, and out-of-order progress events never move backwards', () => {
  const tracker = new ModelLoadProgress([{ file: 'a', size: 100 }, { file: 'b', size: 900 }])
  const events = [
    { file: 'a', status: 'done' },
    { file: 'b', loaded: 450, total: 900 },
    { file: 'a', loaded: 20, total: 100 },
    { file: 'b', loaded: 200, total: 1800 },
    { file: 'unexpected', loaded: 1, total: 10000 },
    { file: 'b', loaded: NaN, total: 900 },
    { file: 'b', status: 'done' },
  ]
  let previous = 0
  for (const event of events) {
    const current = tracker.update(event)
    assert.ok(Number.isFinite(current) && current >= previous && current < 1)
    previous = current
  }
})

test('Cache completions and missing sizes use a fixed file budget', () => {
  const tracker = new ModelLoadProgress([{ file: 'a' }, { file: 'b' }])
  assert.equal(tracker.update({ file: 'a', status: 'done' }), 0.45)
  assert.equal(tracker.update({ file: 'b', status: 'done' }), 0.9)
  assert.equal(tracker.preparing(), 0.95)
  assert.equal(tracker.update({ file: 'a', progress: 0 }), 0.95)
})

test('Metadata failure remains below complete until the GPU is ready; retries start at zero', () => {
  const tracker = new ModelLoadProgress([])
  assert.equal(tracker.update({ file: 'a', status: 'done' }), 0)
  assert.equal(tracker.preparing(), 0.95)
  assert.equal(tracker.ready(), 1)
  assert.equal(new ModelLoadProgress([]).update({}), 0)
})
