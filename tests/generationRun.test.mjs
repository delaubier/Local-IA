import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/generationRun.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const { GenerationRun, isCurrentInterrupt } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('Repeated streamed tool tags send only one interrupt for the same answer', () => {
  const run = new GenerationRun()
  run.start()
  assert.equal(run.requestStop(), true)
  for (let i = 0; i < 20; i++) assert.equal(run.requestStop(), false)
})
test('A delayed interrupt and stale chunks from an old answer cannot stop or overwrite its successor', () => {
  const run = new GenerationRun()
  const oldId = run.start()
  run.requestStop()
  run.finish()
  const nextId = run.start()
  assert.equal(isCurrentInterrupt(nextId, oldId), false)
  assert.equal(isCurrentInterrupt(nextId, nextId), true)
  assert.equal(isCurrentInterrupt(null, oldId), false)
  assert.equal(run.accepts(oldId), false)
  assert.equal(run.accepts(nextId), true)
  assert.equal(run.requestStop(), true)
})
test('A tool continuation sees the current lifecycle despite an old React closure', async () => {
  const run = new GenerationRun()
  const first = run.start()
  const continueAfterSearch = async () => {
    await Promise.resolve()
    assert.equal(run.active, false)
    return run.start()
  }
  run.finish()
  assert.ok(await continueAfterSearch() > first)
})
test('Completion rejects any later events until a new request starts', () => {
  const run = new GenerationRun()
  const id = run.start()
  run.finish()
  assert.equal(run.accepts(id), false)
  assert.equal(run.requestStop(), false)
})
