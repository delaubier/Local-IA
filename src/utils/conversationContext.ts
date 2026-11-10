import { searchTerms } from './webEvidence'

export function isAssistantIdentityQuestion(text: string): boolean {
  return /^(?:(?:bonjour|salut|hello)[,!.\s]+)?(?:quel(?:le)? est (?:ton|votre) nom|(?:c['’]est quoi|donne[- ]moi) ton nom|comment (?:tu t['’]appelles|t['’]appelles[- ]tu|vous appelez[- ]vous)|qui (?:es[- ]tu|êtes[- ]vous)|tu es qui|what(?:'s| is) your name|who are you)[\s?!.]*$/i.test(text.trim())
}

const urls = (text: string): string[] => text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []

const startsNewTopic = (text: string) =>
  /^\s*(?:changeons de sujet|passons [àa] autre chose|nouveau sujet|new topic|let['’]s (?:change|switch) (?:the subject|topics?))(?=$|[\s.,:!?—-])/i.test(text)

export function topicHistory<T extends { role: string }>(history: T[], request: string, authoredText: (turn: T) => string): T[] {
  if (startsNewTopic(request)) return []
  const boundary = history.findLastIndex(turn => turn.role === 'user' && startsNewTopic(authoredText(turn)))
  return boundary > 0 ? history.slice(boundary) : history
}

/** A reference/correction needs the immediately preceding request, regardless of domain. */
export function isContextContinuation(text: string): boolean {
  return /^(?:et\b|mais\b|pas\b|non\b|plut[oô]t\b|and\b|but\b|instead\b)|\b(?:ce site|cette page|cette image|ce document|cette r[eé]ponse|ce r[eé]sultat|son|ses|leur|dessus|celui|celle|lesquels|lesquelles|this (?:page|image|document|answer)|that (?:one|result)|its|their)\b/i.test(text)
}

export function continuesVisualContext(request: string, history: { role: string; text: string; hasImages: boolean }[]): boolean {
  if (!isContextContinuation(request)) return false
  for (const turn of [...topicHistory(history, request, turn => turn.text)].reverse()) {
    if (turn.role !== 'user') continue
    if (turn.hasImages) return true
    if (!isContextContinuation(turn.text)) return false
  }
  return false
}

/** Fresh evidence must not inherit earlier assistant guesses or old page attachments. */
export function selectRequestHistory<T extends { role: string }>(
  history: T[], request: string, freshEvidence: boolean, authoredText: (turn: T) => string,
): T[] {
  if (isAssistantIdentityQuestion(request)) return []
  const scoped = topicHistory(history, request, authoredText)
  if (!freshEvidence) return scoped
  const terms = new Set(searchTerms(request))
  const currentUrls = urls(request)
  const users = scoped.filter((turn) => turn.role === 'user')
  const last = users.at(-1)
  return users.filter((turn) => {
    const text = authoredText(turn)
    const oldUrls = urls(text)
    if (currentUrls.length && oldUrls.some((url) => !currentUrls.includes(url))) return false
    const overlap = searchTerms(text).some((term) => terms.has(term))
    return overlap || (turn === last && isContextContinuation(request))
  }).slice(-3)
}

/** Keep a supplied site on a short topical follow-up; never override a new URL. */
export function followUpSite(request: string, history: { role: string; text: string }[]): string | null {
  if (urls(request).length || isAssistantIdentityQuestion(request)) return null
  const previous = topicHistory(history, request, turn => turn.text).findLast((turn) => turn.role === 'user')
  if (!previous) return null
  const previousUrl = urls(previous.text)[0]
  if (!previousUrl) return null
  const terms = new Set(searchTerms(previous.text.replace(/https?:\/\/\S+/g, '')))
  const overlap = searchTerms(request).some((term) => terms.has(term))
  const reference = /\b(ce site|cette page|dessus|lesquels|lesquelles|les meilleurs|et le|et la|and the|this site)\b/i.test(request)
  return overlap || reference ? previousUrl : null
}

export function countRequestedWord(query: string, text: string): { word: string; count: number } | null {
  if (!/\b(compte|compter|calcul\w*|nombre|combien|count)\b/i.test(query)) return null
  const word = query.match(/["«“]([^"»”\n]{1,60})["»”]/)?.[1]?.trim()
  if (!word || /\s/.test(word)) return null
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const visibleText = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  const matches = visibleText.match(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu'))
  return { word, count: matches?.length ?? 0 }
}
