import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/citations.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText
const { formatCitations, getCitedSources } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const sources = [{ index: 1, domain: 'example.org', url: 'https://example.org/page' }]
test('Verified source numbers become readable domain links', () => {
  assert.equal(formatCitations('Hauteur. [1]', sources), 'Hauteur. [example.org](<https://example.org/page>)')
})

test('Source labels and parentheses become just the clickable citation', () => {
  for (const text of ['Fait (source [1]).', 'Fait (Source : [1]).', 'Fait ([1]).']) {
    assert.equal(formatCitations(text, sources), 'Fait. [example.org](<https://example.org/page>)')
  }
  assert.equal(formatCitations('Fait (source [example.org](https://example.org/page)).', sources), 'Fait. [example.org](<https://example.org/page>)')
  assert.equal(formatCitations('`(source [1])` et (source inconnue).', sources), '`(source [1])` et (source inconnue).')
})

test('Duplicate citations at the beginning and end of a claim appear once after the full stop', () => {
  const link = '[example.org](<https://example.org/page>)'
  assert.equal(formatCitations('[1] Lula a obtenu 50,9 % des voix [1].', sources), `Lula a obtenu 50,9 % des voix. ${link}`)
  assert.equal(formatCitations('1. [1] Lula a obtenu 50,9 % [1].', sources), `1. Lula a obtenu 50,9 %. ${link}`)
  assert.equal(formatCitations('[1] Une affirmation.', sources), `Une affirmation. ${link}`)
  assert.equal(formatCitations('Une affirmation [1][1]. Une autre [1].', sources), `Une affirmation. ${link} Une autre. ${link}`)
  assert.equal(formatCitations('Valeur 3.14 [1].\n\nAutre paragraphe [1].', sources), `Valeur 3.14. ${link}\n\nAutre paragraphe. ${link}`)
})
test('Unmapped or unsafe citations do not imply consulted sources', () => {
  assert.equal(formatCitations('Hauteur. [1]'), 'Hauteur. ')
  assert.equal(formatCitations('Hauteur. [2]', sources), 'Hauteur. ')
  assert.equal(formatCitations('[1]', [{ index: 1, domain: 'bad', url: 'javascript:alert(1)' }]), '')
})
test('Code, existing links, reference definitions and arrays are preserved', () => {
  const text = '`[1]`\n```js\nx[1]\n```\n[1](https://example.org)\n[1]: https://example.org\n![1](image.png)\n[1, 2]'
  assert.equal(formatCitations(text, sources), text)
})

test('Consulted sources without citations are not shown, including an error or greeting', () => {
  for (const text of ['', 'Bonjour !', "Erreur : Cannot read properties of undefined (reading 'dims')", '<think>Source [1]</think>Bonjour.']) {
    assert.deepEqual(getCitedSources(text, sources), [])
  }
})
test('Only sources cited in the final prose or a real Markdown link are retained', () => {
  const second = { index: 2, domain: 'other.org', url: 'https://other.org/page' }
  assert.deepEqual(getCitedSources('Réponse [2].', [...sources, second]), [second])
  assert.deepEqual(getCitedSources('Voir [le site](https://example.org/page).', sources), sources)
  assert.deepEqual(getCitedSources('Voir [le site](<https://example.org/page>).', sources), sources)
  assert.deepEqual(getCitedSources('`[1]` et ```js\nx[2]\n```', [...sources, second]), [])
  assert.deepEqual(getCitedSources('Réponse [1][2].', [...sources, { ...sources[0], index: 2 }]), sources)
})
