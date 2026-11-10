import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { DOMParser } from 'linkedom'
globalThis.DOMParser = DOMParser
async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { performWebResearch, extractWebPage, shouldTriggerWebSearch, buildContextualWebQuery, compactWebQuery } = await load('src/utils/webSearch.ts')
const { canonicalWebUrl, rankWebSources, selectWebPassages, buildWebEvidence } = await load('src/utils/webEvidence.ts')
const { createResearchProviders, DEFAULT_WEB_SETTINGS } = await load('src/utils/webProviders.ts')
const { presidentialQuestionLanguage, previousElectionCountry, electionCountryFromReply, scopeElectionQuestion, electionCalendarLookup } = await load('src/utils/electionScope.ts')
const source = (url, title = 'Tour Eiffel hauteur officielle') => ({ title, url, domain: new URL(url).hostname, snippet: 'La hauteur de la tour Eiffel est documentée par son exploitant officiel.' })

test('A presidential follow-up does not infer a country from a candidate or make an unverified year a search constraint', () => {
  const query = 'Mais qu’en est-il pour les élections présidentielles de 2026 ?'
  assert.equal(presidentialQuestionLanguage(query), 'fr')
  assert.equal(shouldTriggerWebSearch(query), true)
  assert.equal(previousElectionCountry('Qui est Gabriel Attal ? Va-t-il se présenter aux élections présidentielles ?', 'fr'), undefined)
  assert.equal(previousElectionCountry('Quels sondages pour l’élection présidentielle en France ?', 'fr'), 'France')
  assert.equal(electionCountryFromReply('En France.', 'fr'), 'France')
  assert.equal(electionCountryFromReply('Au Brésil.', 'fr'), 'Brésil')
  assert.equal(electionCountryFromReply('Oui', 'fr'), undefined)
  const scoped = scopeElectionQuestion(query, 'France')
  assert.match(scoped, /2026.*France/)
  assert.equal(electionCalendarLookup(scoped, 2026).query, 'calendrier officiel élection présidentielle France')
  assert.match(electionCalendarLookup('Date de la présidentielle de 2022 en France ?', 2026).query, /2022$/)
  assert.equal(electionCalendarLookup('Sondages présidentielle 2026 France ?', 2026), undefined)
  assert.equal(presidentialQuestionLanguage('What about the 2026 presidential election?'), 'en')
  assert.equal(presidentialQuestionLanguage('Élections présidentielles de 2026 au Brésil ?'), undefined)
})

test('Election calendar evidence excludes other jurisdictions and unread snippets', async () => {
  const scope = electionCalendarLookup('Quelle est la date de la présidentielle 2026 en France ?', 2026)
  const sources = [
    { url: 'https://presse.example/haiti', domain: 'presse.example', title: 'Calendrier officiel élection présidentielle en Haïti', snippet: 'Le calendrier compare les dates à celles de la France.' },
    { url: 'https://presse.example/france', domain: 'presse.example', title: 'Calendrier officiel élection présidentielle France', snippet: 'Selon cet extrait du moteur, le calendrier de la présidentielle française paraît en janvier.' },
    { url: 'https://www.service-public.gouv.fr/agenda', domain: 'service-public.gouv.fr', title: 'Élection présidentielle', snippet: 'Calendrier officiel de la prochaine élection présidentielle.' },
    { url: 'https://presse.example/2022', domain: 'presse.example', title: 'Élection présidentielle française de 2022', snippet: 'Calendrier officiel en France.' },
    { url: 'https://presse.example/parti', domain: 'presse.example', title: 'La France insoumise', snippet: 'Élection présidentielle et calendrier.' },
  ]
  const readUrls = []
  const outcome = await performWebResearch(scope.query, undefined, {
    search: async () => sources,
    fallback: async () => [],
    encyclopedia: async () => [],
    read: async url => {
      readUrls.push(url)
      if (url.includes('presse.example')) throw new Error('Page illisible')
      return { title: 'Élection présidentielle', markdown: 'Calendrier officiel. La prochaine élection présidentielle française aura lieu en 2027. La date des deux tours est annoncée sur cette page.' }
    },
  }, undefined, scope)
  assert.ok(!readUrls.includes(sources[0].url))
  assert.ok(!readUrls.includes(sources[3].url) && !readUrls.includes(sources[4].url))
  assert.deepEqual(outcome.sources.map(item => item.url), [sources[2].url])
  assert.match(outcome.contextHeader, /2027/)
})

test('Jina is a bounded fallback after local reading and receives no private or parameterized URL', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push([url, init.credentials])
    if (!url.startsWith('https://r.jina.ai/')) return new Response('', { status: 403 })
    return Response.json({ data: { title: 'Tour Eiffel', content: 'La tour Eiffel atteint 330 mètres. '.repeat(4) } })
  })
  const url = 'https://toureiffel.paris/article'
  const providers = createResearchProviders(DEFAULT_WEB_SETTINGS)
  for (const privateUrl of ['https://127.0.0.1/page', 'https://site.internal/page', `${url}?token=secret`]) {
    assert.equal(await providers.readFallback(privateUrl), undefined)
  }
  const local = await performWebResearch(`Lire ${url}`, undefined, createResearchProviders({ ...DEFAULT_WEB_SETTINGS, provider: 'local' }))
  assert.equal(local.sources.length, 0)
  const rendered = await performWebResearch(`Lire ${url}`, undefined, providers, async () => ({
    title: 'Tour Eiffel', markdown: 'Page déjà rendue. '.repeat(10),
  }))
  assert.equal(rendered.sources.length, 1)
  assert.deepEqual(calls, [[url, 'omit'], [url, 'omit']])
  const result = await performWebResearch(`Lire ${url}`, undefined, providers)
  assert.match(result.contextHeader, /330 mètres/)
  assert.equal(result.sources[0].url, url)
  assert.deepEqual(calls.slice(2), [[url, 'omit'], [`https://r.jina.ai/${url}`, 'omit']])
  assert.ok(await providers.readFallback('https://www.paris.fr/page'))
  assert.equal(await providers.readFallback('https://www.paris.fr/another-page'), undefined)
})

test('a selected API searches on its own and reads source pages without forwarding its key', async t => {
  const page = 'https://toureiffel.paris/hauteur'
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init })
    if (url === 'https://api.tavily.com/search') {
      return Response.json({ results: [{ url: page, title: 'Hauteur de la tour Eiffel', content: 'La tour Eiffel atteint 330 mètres.' }] })
    }
    assert.equal(url, page)
    return new Response('La tour Eiffel atteint 330 mètres avec son antenne. '.repeat(4))
  })
  const providers = createResearchProviders({ ...DEFAULT_WEB_SETTINGS, provider: 'tavily', keys: { tavily: 'test-key' } })
  const result = await performWebResearch('Quelle est la hauteur de la tour Eiffel ?', undefined, providers)
  assert.match(result.contextHeader, /330 mètres/)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[1].init.headers?.Authorization, undefined)
})

test('Brave, Exa, SearXNG and custom API results are adapted to the same page reader', async t => {
  const result = { url: 'https://example.org/eiffel', title: 'Tour Eiffel', description: '330 mètres' }
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push([new URL(url), init.headers])
    return Response.json(url.includes('api.search.brave.com') ? { web: { results: [result] } } : { results: [result] })
  })
  const settings = {
    keys: { brave: 'brave-test', exa: 'exa-test', custom: 'custom-test' },
    endpoints: { searxng: 'http://localhost:8080', custom: 'https://api.example.org/results' },
  }
  for (const provider of ['brave', 'exa', 'searxng', 'custom']) {
    const hits = await createResearchProviders({ ...settings, provider }).search('hauteur Eiffel')
    assert.equal(hits[0].url, result.url)
    assert.equal(hits[0].snippet, result.description)
  }
  assert.equal(calls[0][1]['X-Subscription-Token'], 'brave-test')
  assert.equal(calls[1][1]['x-api-key'], 'exa-test')
  assert.equal(calls[2][0].pathname, '/search')
  assert.equal(calls[2][0].searchParams.get('format'), 'json')
  assert.equal(calls[3][0].searchParams.get('q'), 'hauteur Eiffel')
  assert.equal(calls[3][1].Authorization, 'Bearer custom-test')
})

test('Canonical URLs deduplicate tracking without losing meaningful query parameters', () => {
  assert.equal(canonicalWebUrl('https://example.org/page?id=2&utm_source=x#top'), 'https://example.org/page?id=2')
  assert.equal(canonicalWebUrl('javascript:alert(1)'), null)
  assert.equal(canonicalWebUrl('https://user:password@example.org'), null)
  const results = rankWebSources('Tour Eiffel hauteur', [source('https://a.fr/?utm_source=x'), source('https://a.fr/'), source('https://b.fr/')])
  assert.equal(results.length, 2)
})

test('Table cells stay distinct so event dates can be attached to the right value', () => {
  const html = '<main><h1>Example mission</h1><table><tr><th>Launch</th><td>November 23, 2021</td></tr><tr><th>Impact</th><td>September 26, 2022</td></tr></table></main>'
  const { markdown } = extractWebPage(html, 'https://example.org/mission')
  assert.match(markdown, /Launch \| November 23, 2021\nImpact \| September 26, 2022/)
})

test('Irrelevant search results are removed; a relevant official page beats an unrelated first result', () => {
  const results = rankWebSources('tour Eiffel hauteur', [
    { ...source('https://unrelated.org'), title: 'Recette de gâteau', snippet: 'Cuisson au chocolat et au four.' },
    source('https://toureiffel.paris/fr/monument'),
  ])
  assert.equal(results.length, 1)
  assert.equal(results[0].domain, 'toureiffel.paris')
})

test('Retrieval finds evidence near the end of a long page and stays within its budget', () => {
  const text = 'La visite du monument est agréable. '.repeat(1000) + '\nLe matériau utilisé pour les rivets de la tour Eiffel est le fer puddlé.\n'
  const passages = selectWebPassages('matériau rivets Eiffel', text, 900)
  assert.match(passages, /fer puddlé/)
  assert.ok(passages.length <= 900)
})

test('Evidence distinguishes snippets, dates and page excerpts and fits the prompt budget', () => {
  const result = buildWebEvidence('hauteur Eiffel', [
    { ...source('https://a.fr/'), fullText: 'Tour Eiffel hauteur 330 mètres. '.repeat(1000), publishedAt: '2022-03-15' },
    source('https://b.fr/'),
  ], new Date('2026-11-08T12:00:00Z'))
  assert.match(result.contextHeader, /SEARCH SNIPPET ONLY/)
  assert.match(result.contextHeader, /PAGE EXCERPTS/)
  assert.match(result.contextHeader, /2022-03-15/)
  assert.match(result.contextHeader, /untrusted reference material/)
  assert.ok(result.contextHeader.length < 8000)
})

test('DOM extraction removes menus and scripts while preserving late article evidence', () => {
  const html = `<html><head><title>Tour Eiffel</title><meta property="article:published_time" content="2022-03-15"></head><body><nav>MENU BRUIT</nav><article><h1>Le monument</h1>${'<p>Les visiteurs découvrent le monument et ses étages à Paris. Une visite permet de découvrir son histoire.</p>'.repeat(220)}<p>La hauteur exacte de la tour Eiffel est de 330 mètres.</p><script>INJECTION SCRIPT</script></article><footer>FOOTER BRUIT</footer></body></html>`
  const page = extractWebPage(html, 'https://example.org')
  assert.match(page.markdown, /330 mètres/)
  assert.doesNotMatch(page.markdown, /MENU BRUIT|FOOTER BRUIT|INJECTION SCRIPT/)
  assert.equal(page.publishedAt, '2022-03-15')
  assert.equal(extractWebPage('<html><head><title>Just a moment...</title></head><body>Challenge</body></html>', 'https://example.org').markdown, '')
})

test('Direct URLs are read without an unrelated search and unreadable URLs are not invented as evidence', async () => {
  const providers = {
    search: async () => assert.fail('No search for a supplied URL'),
    fallback: async () => assert.fail('No fallback for a supplied URL'),
    encyclopedia: async () => assert.fail('No encyclopedia for a supplied URL'),
    read: async () => { throw new Error('HTTP 403') },
  }
  const result = await performWebResearch('Résume https://example.org/article', undefined, providers)
  assert.equal(result.sources.length, 0)
  assert.deepEqual(result.attachments, [])
})

test('A listing page retains all cards, including a requested city beyond the first article', () => {
  const html = '<html><head><title>Logements</title></head><body><main>' +
    ['Paris', 'Lyon', 'Rennes'].map((city) => `<article><h2>Résidence ${city}</h2><p>Studio à ${city}, 300 euros par mois, 18 mètres carrés.</p></article>`).join('') +
    '</main></body></html>'
  const page = extractWebPage(html, 'https://example.org/logements')
  for (const city of ['Paris', 'Lyon', 'Rennes']) assert.match(page.markdown, new RegExp(city))
})

test('A single shared generic word is insufficient for a multi-term query', () => {
  const result = rankWebSources('logements Rennes étudiants', [
    { ...source('https://example.org'), title: 'Logements à Marseille', snippet: 'Des offres dans la ville de Marseille.' },
  ])
  assert.equal(result.length, 0)
})

test('A failed search engine recovers once; sources are numbered and injected only once', async () => {
  let fallbacks = 0
  const result = await performWebResearch('tour Eiffel hauteur sans antenne', undefined, {
    search: async (query) => { assert.match(query, /sans antenne/); throw new Error('Timeout') },
    encyclopedia: async () => [],
    fallback: async (query) => {
      fallbacks++
      assert.match(query, /sans/)
      return [source('https://a.fr/'), { ...source('https://b.fr/'), snippet: 'Hauteur de la tour Eiffel sans antenne : une mesure historique distingue la structure de son antenne.' }]
    },
    read: async (url) => {
      if (url.includes('b.fr')) throw new Error('Blocked')
      return { title: 'Tour Eiffel', markdown: 'La hauteur de la tour Eiffel est 330 mètres avec antenne. '.repeat(6) }
    },
  })
  assert.equal(fallbacks, 1)
  assert.deepEqual(result.sources.map((item) => item.index), [1, 2])
  assert.equal(result.sources.find(item => item.domain === 'a.fr')?.evidenceKind, 'page')
  assert.equal(result.sources.find(item => item.domain === 'b.fr')?.evidenceKind, 'snippet')
  assert.deepEqual(result.attachments, [])
  assert.equal(result.sources[0].fullText, undefined)
})

test('Greetings and translation stay local; current factual questions trigger research', () => {
  assert.equal(shouldTriggerWebSearch('Salut comment peux-tu m’être utile ?'), false)
  assert.equal(shouldTriggerWebSearch('Traduis : quel est le président actuel ?'), false)
  assert.equal(shouldTriggerWebSearch('Quel est le président actuel ?'), true)
  assert.equal(shouldTriggerWebSearch('Qu’est-ce qu’un volcan ?'), false)
  assert.equal(shouldTriggerWebSearch('Qu’est-ce qu’un moteur de recherche ?'), false)
  assert.equal(shouldTriggerWebSearch('Quelle est la capitale de la France ?'), false)
  assert.equal(shouldTriggerWebSearch('Qui a écrit Les Misérables ?'), false)
  assert.equal(shouldTriggerWebSearch('What is a good restaurant in Rennes?'), true)
})

test('Follow-ups use user-authored context, not an assistant hallucination or an old unrelated entity', () => {
  const history = [{ role: 'user', text: 'Qui est le fondateur de Microsoft ?' }, { role: 'assistant', text: 'Banane Inconnue serait son dirigeant.' }]
  assert.match(buildContextualWebQuery('Quel est son PDG ?', history), /Microsoft/)
  assert.doesNotMatch(buildContextualWebQuery('Quel est son PDG ?', history), /Banane/)
  assert.equal(buildContextualWebQuery('Combien mesure la tour Eiffel ?', history), 'Combien mesure la tour Eiffel ?')
})

test('Fetched content is rechecked even when the engine snippet looked relevant', async () => {
  const result = await performWebResearch('batterie sodium autonomie', undefined, {
    search: async () => [{ ...source('https://example.org/battery'), title: 'Batterie sodium autonomie', snippet: 'Comparaison de batterie sodium et autonomie mesurée.' }],
    encyclopedia: async () => [], fallback: async () => [],
    read: async () => ({ title: 'Recettes de cuisine', markdown: 'Préparez le gâteau au chocolat avec de la farine et du lait. '.repeat(4) }),
  })
  assert.equal(result.sources.length, 0)
})

test('Three misleading search hits trigger a second search only after reading them', async () => {
  const calls = []
  const result = await performWebResearch('Cherche la date du lancement Artemis I', undefined, {
    search: async () => ['a', 'b', 'c'].map(host => source(`https://${host}.example/`, 'Date lancement Artemis I')),
    encyclopedia: async () => [],
    fallback: async () => {
      assert.equal(calls.length, 3)
      return [source('https://nasa.example/', 'Date lancement Artemis I')]
    },
    read: async url => {
      calls.push(url)
      return url.includes('nasa')
        ? { title: 'Artemis I', markdown: 'La date du lancement de la mission Artemis I est le 16 novembre 2022, depuis le centre spatial Kennedy en Floride.' }
        : { title: 'Page hors sujet', markdown: 'Recette de cuisine au chocolat et à la vanille avec farine et beurre. '.repeat(3) }
    },
  })
  assert.deepEqual(result.sources.map(item => item.domain), ['nasa.example'])
  assert.match(result.contextHeader, /16 novembre 2022/)
})

test('Global evidence favors the exact question, preserves conflicting claims and removes identical copies', () => {
  const query = 'Comparer le niveau du lac Aster en 2024 et 2025'
  const pages = ['a', 'b', 'c', 'd', 'e', 'f'].map(host => ({
    ...source(`https://${host}.example/`, 'Lac Aster'),
    fullText: 'Le lac Aster est une destination de randonnée. Des oiseaux habitent le lac.',
  }))
  pages[4].fullText = 'Le niveau du lac Aster en 2024 était de 14 mètres. En 2025, la mesure du niveau du lac Aster atteint 15 mètres.'
  pages[5].fullText = 'Le niveau du lac Aster en 2025 atteint 18 mètres selon le second relevé dont la méthode est différente.'
  const result = buildWebEvidence(query, pages)
  assert.equal(result.sources[0].domain, 'e.example')
  assert.match(result.contextHeader, /15 mètres/)
  assert.match(result.contextHeader, /18 mètres/)
  assert.ok((result.contextHeader.match(/destination de randonnée/g)?.length ?? 0) <= 1)
})

test('Reformulation preserves quotes and negation and replaces a previous year in a date follow-up', () => {
  assert.equal(compactWebQuery('Peux-tu chercher sur le web « Festival de Loire » 2025 sans billet ?'), '« Festival de Loire » 2025 sans billet ?')
  const result = buildContextualWebQuery('Et en 2024 ?', [
    { role: 'user', text: 'Quel est le nombre de visiteurs du Festival de Loire en 2022 ?' },
    { role: 'assistant', text: 'Le festival de la banane.' },
  ])
  assert.match(result, /2024.*Festival de Loire/)
  assert.doesNotMatch(result, /2022|banane/)
})

test('A supplied URL can use rendered content after a failed read without running a search', async () => {
  const result = await performWebResearch('Horaires du musée https://museum.example/horaires', undefined, {
    search: async () => assert.fail(), encyclopedia: async () => assert.fail(), fallback: async () => assert.fail(),
    read: async () => { throw new Error('HTTP 403') },
  }, async url => {
    assert.equal(url, 'https://museum.example/horaires')
    return { title: 'Horaires du musée', markdown: 'Les horaires du musée sont affichés dans le calendrier. Le musée ouvre à 10 heures du mardi au dimanche.' }
  })
  assert.match(result.contextHeader, /10 heures/)
  assert.equal(result.sources[0].evidenceKind, 'page')
})

test('Research follows at most two observed relevant same-site links, never recursive links', async () => {
  const reads = []
  const links = [1, 2, 3].map((n) => ({ title: `Capteurs humidité ${n}`, url: `https://example.org/details/${n}`, context: 'Capteurs humidité précision technique.' }))
  links.push({ title: 'Capteurs humidité', url: 'https://foreign.org/details', context: 'Capteurs humidité' })
  const result = await performWebResearch('Capteurs humidité précision https://example.org/catalogue', undefined, {
    search: async () => assert.fail(), encyclopedia: async () => assert.fail(), fallback: async () => assert.fail(),
    read: async (url) => {
      reads.push(url)
      return { title: 'Capteurs humidité', markdown: `Capteurs humidité : précision de mesure et conditions de fonctionnement détaillées dans la fiche ${reads.length}.`, links }
    },
  })
  assert.deepEqual(reads, ['https://example.org/catalogue', 'https://example.org/details/1', 'https://example.org/details/2'])
  assert.equal(result.sources.length, 3)
  assert.ok(result.sources.every((s) => s.evidenceKind === 'page' && !s.links))
})

test('Extracted links resolve relative paths and ignore unsafe schemes and navigation noise', () => {
  const page = extractWebPage('<html><body><nav><a href="/menu">Menu</a></nav><main><p>Capteurs humidité : <a href="details/a">fiche technique</a>. <a href="javascript:alert(1)">Action</a></p></main></body></html>', 'https://example.org/catalogue/')
  assert.deepEqual(page.links?.map((l) => l.url), ['https://example.org/catalogue/details/a'])
})

test('A question mark does not send conversational feedback to the web', () => {
  assert.equal(shouldTriggerWebSearch('Peux-tu rendre ta réponse plus claire ?'), false)
})
