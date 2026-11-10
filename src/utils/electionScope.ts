const FRENCH_ELECTION = '(?:[ée]lections?\\s+pr[ée]sidentielles?|pr[ée]sidentielles?)'
const BARE_FRENCH = new RegExp(
  `^(?:(?:bon|mais|et)[, ]+)*(?:(?:qu['’]en est-il (?:pour|des?)|quand (?:a lieu|aura lieu|auront lieu)|(?:quelle est|quelles sont) la date (?:de|des))\\s+)?(?:(?:la|les|l['’])\\s*)?(?:prochaine[s]?\\s+)?${FRENCH_ELECTION}(?:\\s+(?:(?:de|en)\\s+)?\\d{4})?[?!., ]*$`, 'i',
)
const BARE_ENGLISH = /^(?:(?:but|and|so)[, ]+)*(?:(?:what about|how about|when (?:is|are|was|were))\s+)?(?:the\s+)?(?:(?:next|\d{4})\s+)?presidential elections?(?:\s+in\s+\d{4})?[?!., ]*$/i
const PRESIDENTIAL = new RegExp(`\\b(?:${FRENCH_ELECTION}|presidential elections?)\\b`, 'i')

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

let regions: Map<string, string> | undefined
function countryNames() {
  if (regions) return regions
  const names = new Map<string, string>()
  const displays = ['fr', 'en'].map(locale => new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }))
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second)
      if (new Intl.Locale(`und-${code}`).region !== code) continue
      for (const display of displays) {
        const name = display.of(code)
        if (name && name !== code && name !== 'Unknown Region' && name !== 'région indéterminée') names.set(normalize(name), code)
      }
    }
  }
  for (const [name, code] of Object.entries({
    francaise: 'FR', francaises: 'FR', french: 'FR', bresilienne: 'BR', brazilian: 'BR',
    usa: 'US', 'etats unis': 'US', uk: 'GB',
  })) names.set(name, code)
  regions = names
  return names
}

export function presidentialQuestionLanguage(question: string): 'fr' | 'en' | undefined {
  if (BARE_FRENCH.test(question.trim())) return 'fr'
  if (BARE_ENGLISH.test(question.trim())) return 'en'
}

export function isPresidentialLookup(question: string): boolean {
  return PRESIDENTIAL.test(question)
}

export function electionCountryFromReply(reply: string, locale: 'fr' | 'en'): string | undefined {
  const code = countryNames().get(normalize(reply).replace(/^(?:en|au|aux|in|the|le|la|les) /, ''))
  return code && new Intl.DisplayNames([locale], { type: 'region' }).of(code)
}

function mentionedCountries(text: string): Set<string> {
  const content = ` ${normalize(text)} `
  return new Set([...countryNames()].filter(([name]) => content.includes(` ${name} `)).map(([, code]) => code))
}

export function previousElectionCountry(previous: string, locale: 'fr' | 'en'): string | undefined {
  if (!isPresidentialLookup(previous)) return
  const matches = mentionedCountries(previous)
  if (matches.size !== 1) return
  return new Intl.DisplayNames([locale], { type: 'region' }).of([...matches][0])
}

export function scopeElectionQuestion(question: string, country: string): string {
  return `${question.replace(/[?!., ]+$/, '')} — ${country}?`
}

export function electionCalendarLookup(question: string, yearNow = new Date().getFullYear()) {
  if (!isPresidentialLookup(question) || /https?:\/\/|\b(?:sondages?|polls?|candidats?|candidates?|candidatures?|r[ée]sultats?|results?|compar\w*|pr[ée]senter|run for)\b/i.test(question)) return
  const years = [...new Set(question.match(/\b(?:19|20)\d{2}\b/g) ?? [])]
  if (years.length > 1 || (!years.length && !/\b(?:date|calendrier|quand|prochaine?s?|when|calendar|next)\b/i.test(question))) return
  const locale = /\bpresidential elections?\b/i.test(question) ? 'en' : 'fr'
  const countries = mentionedCountries(question)
  if (countries.size !== 1) return
  const code = [...countries][0]
  const country = new Intl.DisplayNames([locale], { type: 'region' }).of(code)
  const year = years[0] && Number(years[0]) < yearNow ? ` ${years[0]}` : ''
  const tld = code === 'GB' ? 'uk' : code.toLowerCase()
  const official = (source: { domain: string }) =>
    (code === 'US' && source.domain.endsWith('.gov')) ||
    (code === 'FR' && source.domain === 'service-public.fr') ||
    ['gov', 'gouv', 'gob', 'go'].some(label => source.domain.endsWith(`.${label}.${tld}`))
  return {
    query: `${locale === 'fr' ? 'calendrier officiel élection présidentielle' : 'official presidential election calendar'} ${country}${year}`,
    evidenceQuery: (locale === 'fr' ? 'dates élection présidentielle vote scrutin premier tour second tour' : 'presidential election voting date first round runoff') + year,
    acceptsSource(source: { title: string; domain: string; snippet: string }) {
      const titleYears = [...source.title.matchAll(/\b((?:19|20)\d{2})\b/g)].map(match => Number(match[1]))
      if (!year && titleYears.length && titleYears.every(value => value < yearNow)) return false
      if (!isPresidentialLookup(source.title) && !/\b(?:calendrier|calendar|dates?)\b/i.test(source.title)) return false
      const titleCountries = mentionedCountries(source.title)
      if (titleCountries.size) return titleCountries.has(code)
      if (official(source)) return true
      return mentionedCountries(source.snippet).has(code)
    },
    isOfficialCalendar(source: { title: string; domain: string; fullText?: string }) {
      return official(source) && isPresidentialLookup(`${source.title} ${source.fullText ?? ''}`) &&
        /\b(?:19|20)\d{2}\b/.test(source.fullText ?? '')
    },
  }
}
