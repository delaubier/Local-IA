import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/smartContext.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const { buildSmartAttachmentContext, estimateTokenCount } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const doc = (id) => ({ id: String(id), fileName: `document-${id}.txt`, type: 'text', content: 'Les détails du document sur le jardin. '.repeat(1000), outline: 'Structure du document. '.repeat(300) })

test('Multiple documents, outlines and oversized chunks fit the combined attachment budget', () => {
  for (const budget of [0, 20, 600, 1800]) {
    for (const count of [1, 3, 10]) {
      const result = buildSmartAttachmentContext(Array.from({ length: count }, (_, i) => doc(i)), 'jardin', budget)
      assert.ok(estimateTokenCount(result.contextText) <= budget, `${count} docs at ${budget}`)
      assert.equal(result.wasRagApplied, true)
    }
  }
})

test('A short document keeps its full contents when it fits', () => {
  const result = buildSmartAttachmentContext([{ id: '1', fileName: 'note.txt', type: 'text', content: 'Un jardin fleuri.' }], 'jardin', 1800)
  assert.match(result.contextText, /Un jardin fleuri\./)
  assert.equal(result.wasRagApplied, false)
})
