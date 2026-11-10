// Optional live smoke check; never part of the deterministic test suite.
import { build } from 'esbuild'
import { DOMParser } from 'linkedom'
globalThis.DOMParser = DOMParser
if (process.argv.includes('--trace')) {
  const request = globalThis.fetch
  globalThis.fetch = async (...args) => {
    const response = await request(...args)
    const html = await response.clone().text()
    console.log(JSON.stringify({ url: String(args[0]), status: response.status, resultLinks: (html.match(/result__a/g) || []).length }))
    return response
  }
}
const result = await build({ entryPoints: ['src/utils/webSearch.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { performWebResearch, fetchAndCleanWebPage } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
if (process.argv[2] === '--pages') {
  for (const url of ['https://fr.wikipedia.org/wiki/Tour_Eiffel', 'https://www.toureiffel.paris/fr/le-monument/chiffres-cles']) {
    try { const page = await fetchAndCleanWebPage(url); console.log(JSON.stringify({ url, title: page.title, chars: page.markdown.length })) }
    catch (error) { console.log(JSON.stringify({ url, error: String(error), stack: error.stack?.split('\n').slice(0, 2).join('\n').slice(0, 300) })) }
  }
  process.exit(0)
}
const started = Date.now()
const outcome = await performWebResearch(process.argv[2] || 'tour Eiffel hauteur site officiel')
console.log(JSON.stringify({ durationMs: Date.now() - started, sources: outcome.sources.map(({ title, url, evidenceKind }) => ({ title, url, evidenceKind })), contextChars: outcome.contextHeader.length }, null, 2))
