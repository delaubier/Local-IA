import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Load the actual TypeScript utility without the browser or the model runtime.
const source = readFileSync(new URL('../src/utils/replyLanguage.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const { originalRequest, replyLanguageInstruction } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

test('Web results and internal English instructions cannot replace the original French request', () => {
  const query = 'je cherche un article de journal de 1895 à propos de la locomotive qui est sorti du mur de Montparnasse'
  const enriched = 'Web search results: The train crashed at Montparnasse. '.repeat(30) + query
  const instruction = replyLanguageInstruction(originalRequest(enriched, query))
  assert.ok(instruction.includes(JSON.stringify(query)))
  assert.ok(!instruction.includes('The train crashed'))
  assert.ok(!instruction.includes('Reply entirely in English'))
})

test('Original requests are retained across languages without a forced French fallback', () => {
  for (const request of [
    'Tell me about this train accident.', '¿Puedes explicar este accidente?',
    'Erkläre mir diesen Unfall.', 'Spiegami questo incidente.',
    'Kun je dit ongeval uitleggen?', 'この事故について説明してください。',
    'اشرح لي هذا الحادث', 'इस दुर्घटना के बारे में बताओ', 'Объясни эту аварию.',
  ]) {
    assert.ok(replyLanguageInstruction(originalRequest('English source content', request)).includes(JSON.stringify(request)))
  }
})

test('Direct chat, language switches and explicit translation requests retain the latest request', () => {
  assert.equal(originalRequest('Bonjour'), 'Bonjour')
  assert.equal(originalRequest('Bonjour', 'Now explain in English'), 'Now explain in English')
  const translation = replyLanguageInstruction('Traduis ce texte en allemand.')
  assert.match(translation, /explicit request.*takes precedence/)
  assert.match(translation, /earlier assistant replies must NOT determine/)
})
