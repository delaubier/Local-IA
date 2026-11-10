import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { isAssistantIdentityQuestion, selectRequestHistory, countRequestedWord, continuesVisualContext } = await load('src/utils/conversationContext.ts')
const { detectAutoToolIntent, shouldTriggerWebSearch, detectModelToolCall, extractModelWebSearchQuery, buildContextualWebQuery } = await load('src/utils/webSearch.ts')
const { hasUsableAnswer } = await load('src/utils/thinkingBudget.ts')
const { modelForRequest, getModelSpec, DEFAULT_MODEL_ID } = await load('src/llm-protocol.ts')
const { exactPercentage } = await load('src/utils/exactCalculation.ts')

test('Explicit topic changes stop old evidence, URLs and facts from crossing into the new topic', () => {
  const history = [
    { role: 'user', text: 'Compare les logements à Rennes https://example.org/rennes' },
    { role: 'assistant', text: 'Voici des logements.' },
  ]
  const newTopic = { role: 'user', text: 'Changeons de sujet. Donne la population de Nantes en 2022.' }
  assert.deepEqual(selectRequestHistory(history, newTopic.text, false, turn => turn.text), [])
  assert.deepEqual(selectRequestHistory([...history, newTopic], 'Et en 2024 ?', false, turn => turn.text), [newTopic])
  assert.match(buildContextualWebQuery('Et en 2024 ?', [...history, newTopic]), /population de Nantes/)
  assert.doesNotMatch(buildContextualWebQuery('Et en 2024 ?', [...history, newTopic]), /Rennes|example\.org/)
})

test('Standalone percentages are exact, round ties to cents and leave ambiguous questions to the model', () => {
  assert.equal(exactPercentage('Calcule exactement 18,5 % de 347,20 €. Donne seulement le montant arrondi au centime.'), '64,23 €')
  assert.equal(exactPercentage('50 % de 0,01 € arrondi au centime'), '0,01 €')
  assert.equal(exactPercentage('What is 2.5% of -0.2?'), '−0.005')
  assert.equal(exactPercentage('What is 10% of 1,000?'), undefined)
  assert.equal(exactPercentage('Explique pourquoi 18,5 % de 347,20 € ne suffit pas.'), undefined)
})

test('Conversation uses the text checkpoint; image analysis uses the separate visual checkpoint', () => {
  assert.equal(getModelSpec(modelForRequest(false)).repoId, 'LiquidAI/LFM3-1.7B-GGUF')
  assert.equal(getModelSpec(modelForRequest(false)).dtype, 'Q8_0')
  assert.equal(getModelSpec(modelForRequest(true)).isVision, true)
  assert.equal(modelForRequest(false), DEFAULT_MODEL_ID)
})

test('A series of visual follow-ups retains the image, but a new topic releases it', () => {
  const image = { role: 'user', text: 'Décris cette image', hasImages: true }
  const follow = { role: 'user', text: 'Et sa couleur ?', hasImages: false }
  assert.equal(continuesVisualContext('Et ses dimensions ?', [image, follow]), true)
  assert.equal(continuesVisualContext('Explique les volcans', [image, follow]), false)
  assert.equal(continuesVisualContext('Et sa couleur ?', [image, { ...follow, text: 'Décris un vélo' }]), false)
})

test('Fresh context retains a correction in any domain but not an unrelated old constraint', () => {
  const history = [
    { role: 'user', text: 'Mon budget logement est de 400 euros.' },
    { role: 'assistant', text: 'Voici un logement.' },
    { role: 'user', text: 'Un capteur humidité précis à 2 pour cent, usage extérieur.' },
    { role: 'assistant', text: 'Un modèle inventé.' },
  ]
  assert.deepEqual(selectRequestHistory(history, 'Mais une autre marque', true, (m) => m.text), [history[2]])
  assert.deepEqual(selectRequestHistory(history, 'Histoire des volcans islandais', true, (m) => m.text), [])
})

test('Assistant name questions cannot search for a film with matching words', () => {
  for (const query of ['Quelle est ton nom ?', 'Quel est ton nom ?', 'Comment tu t’appelles ?', 'Who are you?']) {
    assert.equal(isAssistantIdentityQuestion(query), true)
    assert.equal(detectAutoToolIntent(query), null)
    assert.equal(shouldTriggerWebSearch(query), false)
    assert.deepEqual(selectRequestHistory([{ role: 'assistant', text: 'Un film historique...' }], query, false, (m) => m.text), [])
  }
  assert.equal(isAssistantIdentityQuestion('Quel est le nom du président ?'), false)
})

test('Late and quoted tools never interrupt a visible answer, including after reasoning', () => {
  for (const text of [
    'Voici une réponse cohérente. [WEB_SEARCH: logement Rennes]',
    '<think>Analyse terminée.</think>Voici une réponse cohérente. [TOOL:PAGE]',
    'Exemple : `[WEB_SEARCH: Rennes]`.',
    '```\n[TOOL:SCREEN]\n```',
  ]) {
    assert.equal(detectModelToolCall(text, false), null)
    assert.equal(extractModelWebSearchQuery(text), null)
    assert.equal(hasUsableAnswer(text, false), true)
  }
  assert.equal(detectModelToolCall('<think>Analyse</think>[WEB_SEARCH: logement Rennes]', false), 'web')
  assert.equal(extractModelWebSearchQuery('[WEB_SEARCH: logement Rennes]'), 'logement Rennes')
  assert.equal(hasUsableAnswer('[WEB_SEARCH: logement Rennes]', false), false)
})

test('Fresh CROUS evidence excludes Wikipedia/Action Logement answers and retains relevant user constraints', () => {
  const history = [
    { role: 'user', text: 'Je veux que tu me dises le pourcentage obtenu par Lula.' },
    { role: 'user', text: 'Compte le mot "le" sur https://fr.wikipedia.org/wiki/Film' },
    { role: 'assistant', text: 'Le film historique... [1]' },
    { role: 'user', text: 'Je cherche un studio à Rennes, budget maximum 400 euros.' },
    { role: 'assistant', text: 'Action Logement propose... [1]' },
  ]
  const request = 'Pas Action Logement mais https://trouverunlogement.lescrous.fr/tools/48/search'
  const kept = selectRequestHistory(history, request, true, (m) => m.text)
  assert.deepEqual(kept, [history[3]])
  assert.equal(selectRequestHistory(history, 'Explique ta réponse', false, (m) => m.text), history)
})

test('A topical follow-up keeps the requested URL and a new URL always wins', () => {
  const url = 'https://trouverunlogement.lescrous.fr/tools/48/search'
  const history = [{ role: 'user', text: `Va sur ce site et trouve les meilleurs logements à Rennes ${url}` }]
  assert.equal(buildContextualWebQuery('Recherche moi les meilleurs logements', history), `Recherche moi les meilleurs logements\n${url}`)
  const next = 'Résume https://example.org/nouveau'
  assert.equal(buildContextualWebQuery(next, history), next)
  assert.equal(buildContextualWebQuery('Qui est Lula ?', history), 'Qui est Lula ?')
})

test('Word counts use the supplied page text, whole words and Unicode boundaries', () => {
  assert.deepEqual(countRequestedWord('Calcule le nombre de "le" écrit', 'Le titre et le texte, avec lequel et belle. LE.'), { word: 'le', count: 3 })
  assert.deepEqual(countRequestedWord('Compte "été"', 'été ÉTÉ étés préété'), { word: 'été', count: 2 })
  assert.deepEqual(countRequestedWord('Compte "le"', '[le](https://example.org/le) texte'), { word: 'le', count: 1 })
  assert.equal(countRequestedWord('Explique "le"', 'le texte'), null)
})
