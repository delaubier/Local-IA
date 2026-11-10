import { tr } from './i18n'
import { canonicalWebUrl } from './webEvidence'
import { defaultProviders, fetchWebText, type ResearchProviders, type WebSearchSource } from './webSearch'

export const WEB_PROVIDERS = {
  'local-jina': 'LocalAI + Jina Reader',
  local: 'LocalAI uniquement',
  tavily: 'Tavily Search',
  brave: 'Brave Search API',
  exa: 'Exa Search',
  searxng: 'SearXNG',
  custom: 'API JSON personnalisée',
} as const

export type WebProvider = keyof typeof WEB_PROVIDERS
type ApiProvider = Exclude<WebProvider, 'local' | 'local-jina'>
export interface WebSettings {
  provider: WebProvider
  keys: Partial<Record<ApiProvider, string>>
  endpoints: Partial<Record<'searxng' | 'custom', string>>
}

export const DEFAULT_WEB_SETTINGS: WebSettings = { provider: 'local-jina', keys: {}, endpoints: {} }
export const WEB_SETTINGS_KEY = 'localaiWebSettings'

export function readWebSettings(): WebSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(WEB_SETTINGS_KEY) ?? 'null') as Partial<WebSettings> | null
    if (!saved?.provider || !Object.hasOwn(WEB_PROVIDERS, saved.provider)) return DEFAULT_WEB_SETTINGS
    return { provider: saved.provider, keys: saved.keys ?? {}, endpoints: saved.endpoints ?? {} }
  } catch { return DEFAULT_WEB_SETTINGS }
}

async function requestJson(url: string, options: RequestInit, timeout = 6500): Promise<unknown> {
  const { text } = await fetchWebText(url, timeout, { ...options, redirect: 'error' })
  return JSON.parse(text)
}

function toSources(value: unknown): Omit<WebSearchSource, 'index'>[] {
  if (!Array.isArray(value)) throw new Error(tr('Format de résultats non reconnu.'))
  const sources: Omit<WebSearchSource, 'index'>[] = []
  for (const result of value.slice(0, 20)) {
    if (typeof result?.url !== 'string' || typeof result.title !== 'string') continue
    const url = canonicalWebUrl(result.url)
    if (!url) continue
    const snippet = result.content ?? result.description ?? result.snippet ?? result.highlights?.[0] ?? ''
    sources.push({
      url, domain: new URL(url).hostname, title: result.title.slice(0, 300),
      snippet: typeof snippet === 'string' ? snippet.slice(0, 4000) : '',
    })
    if (sources.length === 6) break
  }
  return sources
}

function customSearchUrl(endpoint: string, provider: 'searxng' | 'custom', query: string): URL {
  try {
    const url = new URL(endpoint)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!(url.protocol === 'https:' || (loopback && url.protocol === 'http:')) || url.username || url.password) {
      throw new Error()
    }
    url.hash = ''
    if (provider === 'searxng') {
      if (!/\/search\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/$/, '') + '/search'
      url.searchParams.set('format', 'json')
    }
    url.searchParams.set('q', query)
    return url
  } catch {
    throw new Error(tr('Renseignez une URL HTTPS valide ou une adresse HTTP sur localhost.'))
  }
}

async function searchApi(provider: ApiProvider, settings: WebSettings, query: string) {
  const key = settings.keys[provider]?.trim()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if ((provider === 'brave' || provider === 'exa') && !key) {
    throw new Error(tr('Ajoutez la clé API de ce fournisseur dans les paramètres.'))
  }
  let url: URL
  let body: string | undefined
  switch (provider) {
    case 'tavily':
      url = new URL('https://api.tavily.com/search')
      if (key) headers.Authorization = `Bearer ${key}`
      else headers['X-Tavily-Access-Mode'] = 'keyless'
      body = JSON.stringify({ query, search_depth: 'basic', max_results: 6, include_answer: false })
      break
    case 'brave':
      url = new URL('https://api.search.brave.com/res/v1/web/search')
      url.search = new URLSearchParams({ q: query, count: '6' }).toString()
      headers['X-Subscription-Token'] = key!
      break
    case 'exa':
      url = new URL('https://api.exa.ai/search')
      headers['x-api-key'] = key!
      body = JSON.stringify({ query, numResults: 6, contents: { highlights: true } })
      break
    case 'searxng':
    case 'custom':
      url = customSearchUrl(settings.endpoints[provider]?.trim() ?? '', provider, query)
      if (key) headers.Authorization = `Bearer ${key}`
      break
  }
  if (body) headers['Content-Type'] = 'application/json'
  let data: { results?: unknown; web?: { results?: unknown } } | null
  try {
    data = await requestJson(url.href, { method: body ? 'POST' : 'GET', headers, body }) as typeof data
  } catch (error) {
    const status = error instanceof Error ? error.message.match(/^HTTP \d{3}$/)?.[0] : undefined
    throw new Error(`${WEB_PROVIDERS[provider]} · ${status ?? tr('Le fournisseur de recherche ne répond pas.')}`)
  }
  return toSources(provider === 'brave' ? data?.web?.results ?? [] : data?.results)
}

function jinaUrl(raw: string): string | undefined {
  const canonical = canonicalWebUrl(raw)
  if (!canonical) return
  const url = new URL(canonical)
  // Do not delegate local hosts, IP literals, nonstandard ports or query strings.
  if (url.protocol !== 'https:' || url.port || url.search ||
    !/\.[a-z][a-z0-9-]{1,62}$/i.test(url.hostname) ||
    /\.(?:localhost|local|internal|lan|home|test|invalid|example|onion|corp|arpa)$/i.test(url.hostname)) return
  return canonical
}

export function createResearchProviders(settings: WebSettings): ResearchProviders {
  const { provider } = settings
  if (provider === 'local') return defaultProviders
  if (provider === 'local-jina') {
    let reads = 0
    return {
      ...defaultProviders,
      async readFallback(raw) {
        const url = jinaUrl(raw)
        if (!url || reads >= 2) return
        reads++
        const response = await requestJson(`https://r.jina.ai/${url}`, {
          headers: { Accept: 'application/json', 'X-Timeout': '5' },
        }) as { data?: { title?: string; content?: string; publishedTime?: string } }
        const data = response?.data
        if (typeof data?.content !== 'string' || data.content.trim().length < 80) return
        return {
          title: typeof data.title === 'string' ? data.title.slice(0, 300) : '',
          markdown: data.content.slice(0, 100_000),
          publishedAt: typeof data.publishedTime === 'string' && !Number.isNaN(Date.parse(data.publishedTime))
            ? data.publishedTime.slice(0, 64)
            : undefined,
        }
      },
    }
  }
  return {
    ...defaultProviders,
    search: query => searchApi(provider, settings, query),
    fallback: async () => [],
    encyclopedia: async () => [],
    strictSearch: true,
  }
}
