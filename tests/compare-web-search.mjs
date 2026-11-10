import { build } from 'esbuild'
import { DOMParser } from 'linkedom'
import { mkdir, writeFile } from 'node:fs/promises'

globalThis.DOMParser = DOMParser
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => 'fr' }, configurable: true })

async function loadSearch(path, variant = '') {
  const bundle = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}#${variant}`)
}

const searchPath = 'src/utils/webSearch.ts'
const current = await loadSearch(searchPath, 'localai')
const baselinePath = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length)
const baseline = baselinePath ? await loadSearch(baselinePath, 'baseline') : undefined
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice('--report='.length)
const questionFilter = process.argv.find(arg => arg.startsWith('--question='))?.slice('--question='.length)

// Use fixed public questions. No chat history or private URLs leave this benchmark.
const questions = [
  { query: 'Quelle est la date du lancement Artemis I ?', markers: [/16 (?:novembre|November) 2022|Nov(?:ember|\.)? 16,? 2022|2022-11-16/i] },
  { query: 'What is the altitude of Mount Everest officially announced by Nepal and China in 2020?', markers: [/8[,.\s]?848[,.]86/] },
  { query: 'Combien mesure la tour Eiffel avec son antenne depuis 2022 ?', markers: [/330\s*(?:mètres|metres|meters|m\b)/i] },
  { query: 'Quel jour a eu lieu la cérémonie d’ouverture des Jeux olympiques de Paris 2024 ?', markers: [/26 (?:juillet|July)(?: 2024)?|July 26(?:,? 2024)?|2024-07-26/i] },
  { query: 'Which asteroid did NASA’s DART spacecraft hit and on what date?', markers: [/\bDimorphos\b/i, /(?:September|Sept?\.) 26,? 2022|26 September 2022|2022-09-26/i] },
  { query: 'Sur quelle comète la sonde Philae s’est-elle posée et à quelle date ?', markers: [/\b67P\b/i, /12 (?:novembre|November) 2014|Nov(?:ember|\.)? 12,? 2014|2014-11-12|12\/11\/2014/i] },
]

const variants = []
if (baseline) variants.push(['Avant', query => baseline.performWebResearch(query)])
variants.push(['LocalAI', query => current.performWebResearch(query)])
for (const [provider, label] of [['tavily', 'Tavily'], ['brave', 'Brave Search API'], ['exa', 'Exa'], ['searxng', 'SearXNG'], ['custom', 'API JSON']]) {
  if (!process.argv.includes(`--${provider}`)) continue
  const { createResearchProviders } = await loadSearch('src/utils/webProviders.ts', provider)
  const key = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim()
  const endpoint = process.env[`${provider.toUpperCase()}_SEARCH_URL`]?.trim()
  const settings = { provider, keys: { [provider]: key }, endpoints: { [provider]: endpoint } }
  const name = provider === 'tavily' && !key ? 'Tavily sans clé' : label
  variants.push([name, query => current.performWebResearch(query, undefined, createResearchProviders(settings))])
}

if (process.argv.includes('--jina')) {
  const { createResearchProviders, DEFAULT_WEB_SETTINGS } = await loadSearch('src/utils/webProviders.ts', 'jina')
  variants.push(['LocalAI + Jina', async query => {
    const providers = createResearchProviders(DEFAULT_WEB_SETTINGS)
    const jinaReads = []
    const outcome = await current.performWebResearch(query, undefined, {
      ...providers,
      async readFallback(url) {
        try {
          const page = await providers.readFallback(url)
          if (page) jinaReads.push({ url, status: 'lu' })
          return page
        } catch (error) {
          jinaReads.push({ url, status: error.message })
        }
      },
    })
    return { ...outcome, jinaReads }
  }])
}

const report = []
for (const { query, markers } of questions) {
  if (questionFilter && !query.toLowerCase().includes(questionFilter.toLowerCase())) continue
  console.log(`\n${query}`)
  for (const [name, run] of variants) {
    const start = performance.now()
    try {
      const { sources, contextHeader, evidence, jinaReads } = await run(query)
      const elapsed = ((performance.now() - start) / 1000).toFixed(2)
      const passages = evidence?.blocks.map(block => JSON.parse(block).text).join('\n') ?? contextHeader
      const matches = markers.filter(pattern => pattern.test(passages)).length
      report.push({ name, query, elapsed: Number(elapsed), matches, expected: markers.length, sources, contextHeader, evidence })
      console.log(`${name} · ${elapsed} s · ${matches}/${markers.length} repère(s) attendu(s) · ${sources.length} source(s)`)
      for (const source of sources) console.log(`  ${source.evidenceKind}  ${source.url}`)
      if (jinaReads) {
        for (const { url, status } of jinaReads) console.log(`  Jina ${status}  ${url}`)
      }
    } catch (error) {
      report.push({ name, query, error: error.message })
      console.log(`${name} · échec (${error.message})`)
      process.exitCode = 1
    }
  }
}

if (reportPath) {
  await mkdir('.local', { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2))
}
