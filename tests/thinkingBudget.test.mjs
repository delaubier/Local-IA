import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/thinkingBudget.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const { ThinkingBudget, promptStartsThinking, hasFinalAnswer, hasUsableAnswer } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('Token budget closes thinking and allows the answer to continue', () => {
  const budget = new ThinkingBudget([10], [11], true, true, 3, 1000)
  assert.equal(budget.next([], 0), undefined)
  assert.equal(budget.next([1, 2], 1), undefined)
  assert.equal(budget.next([1, 2, 3], 2), 11)
  assert.equal(budget.next([1, 2, 3, 11], 3), undefined)
  assert.equal(budget.thinking, false)
  assert.equal(budget.next([1, 2, 3, 11, 20, 21], 2000), undefined)
})
test('Time budget closes at the next decoding step, independently of token speed', () => {
  const budget = new ThinkingBudget([10], [11], true, true, 999, 12000)
  budget.next([], 50)
  assert.equal(budget.next([1], 12049), undefined)
  assert.equal(budget.next([1, 2], 12050), 11)
})
test('Natural closing does not force another delimiter', () => {
  const budget = new ThinkingBudget([10], [11], true, true, 3, 1000)
  assert.equal(budget.next([1, 11, 20], 2000), undefined)
  assert.equal(budget.thinking, false)
})
test('Unexpected thinking in quick mode closes immediately, including multi-token delimiters', () => {
  const budget = new ThinkingBudget([10, 12], [11, 13], false, false)
  assert.equal(budget.next([10n, 12n], 0), 11)
  assert.equal(budget.next([10n, 12n, 11n], 1), 13)
  assert.equal(budget.next([10n, 12n, 11n, 13n, 20n], 2), undefined)
  assert.equal(budget.thinking, false)
})
test('Actual prompt delimiters determine the initial display phase', () => {
  assert.equal(promptStartsThinking('assistant\n<think>\n'), true)
  assert.equal(promptStartsThinking('assistant\n<think>\n</think>\n'), false)
  assert.equal(promptStartsThinking('assistant\n'), false)
})
test('Reasoning alone and empty responses trigger recovery; answers and tool calls do not', () => {
  assert.equal(hasFinalAnswer('<think>long reasoning'), false)
  assert.equal(hasFinalAnswer('<think>reasoning</think><|im_end|>'), false)
  assert.equal(hasFinalAnswer('<think>reasoning</think>Bonjour.'), true)
  assert.equal(hasFinalAnswer('[WEB_SEARCH: Eiffel]'), true)
})

test('Reported fragments trigger recovery without rejecting useful short answers', () => {
  for (const text of ['V', 'Vo', 'La', '<think>reasoning</think>La', '<think>unfinished']) {
    assert.equal(hasUsableAnswer(text, false), false)
  }
  for (const text of ['Oui.', 'Non', '42', 'Paris', 'Bonjour !', 'Voici plusieurs idées de créations en feutrine.']) {
    assert.equal(hasUsableAnswer(text, false), true)
  }
})
test('A tool request can hand off once, but cannot replace the answer after tool results', () => {
  assert.equal(hasUsableAnswer('[WEB_SEARCH: feutrine]', true), true)
  assert.equal(hasUsableAnswer('[WEB_SEARCH: feutrine]', false), false)
  assert.equal(hasUsableAnswer('<think>reasoning</think>[TOOL:PAGE]', false), false)
})
