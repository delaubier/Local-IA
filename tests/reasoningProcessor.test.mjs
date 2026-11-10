import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Tensor, LogitsProcessor } from '@huggingface/transformers'

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const source = compile('../src/utils/reasoningProcessor.ts')
  .replace("'@huggingface/transformers'", JSON.stringify(import.meta.resolve('@huggingface/transformers')))
  .replace("'./thinkingBudget'", JSON.stringify(dataUrl(compile('../src/utils/thinkingBudget.ts'))))
const { createReasoningProcessor } = await import(dataUrl(source))
const options = { promptLength: 2, opening: [1], closing: [2], endTokens: [3], initiallyThinking: true, enabled: true }
const logits = () => new Tensor('float32', new Float32Array([1, 2, 3, 4, 5]), [1, 5])

test('Actual Transformers processor chain preserves the tensor and dims for sampling', () => {
  for (const initiallyThinking of [false, true]) {
    const processor = createReasoningProcessor({ ...options, initiallyThinking }, () => 0)
    class NextProcessor extends LogitsProcessor {
      _call(_ids, scores) { assert.deepEqual(scores.dims, [1, 5]); return scores }
    }
    processor.push(new NextProcessor())
    const scores = logits()
    const result = processor([[4n, 4n]], scores)
    assert.equal(result, scores)
    assert.deepEqual(result.dims, [1, 5])
    assert.equal(result.data[initiallyThinking ? 3 : 1], -Infinity)
  }
})

test('Forced end of reasoning returns usable scores, then permits the final answer', () => {
  let now = 0
  const processor = createReasoningProcessor(options, () => now)
  processor([[4n, 4n]], logits())
  now = 12000
  const forced = processor([[4n, 4n, 0n]], logits())
  assert.deepEqual([...forced.data], [-Infinity, -Infinity, 0, -Infinity, -Infinity])
  const answering = processor([[4n, 4n, 0n, 2n]], logits())
  assert.deepEqual(answering.dims, [1, 5])
  assert.equal(answering.data[3], 4)
  assert.equal(answering.data[1], -Infinity)
})

test('Quick mode also returns the tensor when it closes unexpected reasoning', () => {
  const processor = createReasoningProcessor({ ...options, enabled: false }, () => 0)
  const result = processor([[4n, 4n]], logits())
  assert.equal(result.data[2], 0)
  assert.deepEqual(result.dims, [1, 5])
})
