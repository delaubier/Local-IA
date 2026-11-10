import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/inferenceLimits.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const { boundedImageSize, fitVisionContext, inferenceErrorMessage, MAX_VISION_PROMPT_TOKENS } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('Screenshots and tall pages stay within pixel and edge budgets without upscaling', () => {
  for (const [width, height] of [[3840, 2160], [1200, 30000], [30000, 1200], [640, 640], [100, 70]]) {
    const size = boundedImageSize(width, height)
    assert.ok(size.width * size.height <= 640 * 640)
    assert.ok(Math.max(size.width, size.height) <= 1024)
    assert.ok(size.width <= width && size.height <= height)
    assert.ok(Math.abs(size.width / size.height - width / height) < width / height * 0.04)
  }
  assert.deepEqual(boundedImageSize(100, 70), { width: 100, height: 70 })
})

test('A 9843-token vision prompt is pruned before inference, preserving system and latest user', async () => {
  const messages = [{ role: 'system' }, { role: 'user', image: 'old' }, { role: 'assistant' }, { role: 'user', image: 'new' }]
  const disposed = []
  const result = await fitVisionContext(messages, async (turns) => ({ value: turns, tokens: turns.length > 2 ? 9843 : 2500 }),
    async (value) => { disposed.push(value) })
  assert.deepEqual(result.value, [messages[0], messages[3]])
  assert.equal(result.dropped, 2)
  assert.equal(disposed.length, 1)
  assert.equal(messages.length, 4) // Displayed history is untouched.
})

test('An oversized latest request is rejected and disposed, never silently truncated', async () => {
  let disposed = 0
  await assert.rejects(fitVisionContext([{ role: 'system' }, { role: 'user' }], async () => ({ value: {}, tokens: 9843 }),
    async () => { disposed++ }), /trop volumineux/)
  assert.equal(disposed, 1)
})

test('The exact budget is accepted and missing processed input IDs fail before inference', async () => {
  const result = await fitVisionContext([{ role: 'user' }], async () => ({ value: {}, tokens: MAX_VISION_PROMPT_TOKENS }),
    async () => { assert.fail('Valid input must be kept') })
  assert.equal(result.dropped, 0)
  await assert.rejects(fitVisionContext([{ role: 'user' }], async () => ({ value: {}, tokens: 0 }), async () => {}), /préparer/)
})

test('WebGPU allocation errors become actionable while other errors keep their cause', () => {
  assert.match(inferenceErrorMessage(new Error('failed to call OrtRun(). Buffer size (3100308768) exceeds the max buffer size limit (2147483648).')), /mémoire graphique/)
  assert.equal(inferenceErrorMessage(new Error('Network unavailable')), 'Network unavailable')
})
