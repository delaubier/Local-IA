type CitationSource = { index: number; url: string; domain: string }

function placeCitations(part: string, sources: CitationSource[]): string {
  const links: string[] = []
  const stored: string[] = []
  // Mask URLs before sentence processing so dots in domains are never punctuation.
  const masked = part.replace(/(?<!!)\[([^\]\n]+)\]\(<?(https?:\/\/[^\s<>]+?)>?(?:\s+"[^"]*")?\)/g, (link, _label, url) => {
    const source = sources.find((item) => item.url === url)
    if (!source) { stored.push(link); return `\uE002${stored.length - 1}\uE003` }
    let id = links.findIndex((value) => value === source.url)
    if (id < 0) { id = links.length; links.push(source.url) }
    return `\uE000${id}\uE001`
  })
  const tag = '\\uE000(\\d+)\\uE001'
  const normalized = masked.split('\n').map((line) => {
    // Deduplicate a leading citation if the same source already follows the claim.
    line = line.replace(/^(\s*(?:(?:[-*+]|\d+\.)\s+)?)(\uE000\d+\uE001\s*)+/g, (leading, prefix) => {
      const refs = leading.match(/\uE000\d+\uE001/g) ?? []
      const rest = line.slice(leading.length)
      return prefix + refs.filter((ref: string) => !rest.includes(ref)).join(' ')
        + (refs.some((ref: string) => !rest.includes(ref)) ? ' ' : '')
    })
    const prefix = line.match(/^\s*(?:(?:[-*+]|\d+\.)\s+|#{1,6}\s+)/)?.[0] ?? ''
    const body = line.slice(prefix.length)
    // Complete sentences include citations already placed after their punctuation.
    const sentences = body.match(/.*?[.!?…]+(?=\s|$|\uE000)(?:\s*\uE000\d+\uE001)*|.+$/g) ?? []
    return prefix + sentences.map((sentence) => {
      const ids = [...new Set([...sentence.matchAll(new RegExp(tag, 'g'))].map((match) => Number(match[1])))]
      if (!ids.length) return sentence
      const leadingSpace = sentence.match(/^\s*/)?.[0] ?? ''
      const prose = sentence.replace(new RegExp(tag, 'g'), '').replace(/\s+([.!?,;:])/g, '$1').trim()
      return leadingSpace + prose + (prose ? ' ' : '') + ids.map((id) => `\uE000${id}\uE001`).join(' ')
    }).join('')
  }).join('\n')
  return normalized.replace(/\uE000(\d+)\uE001/g, (_tag, id) => {
    const source = sources.find((item) => item.url === links[Number(id)])!
    return `[${source.domain.replace(/[\[\]\\]/g, '')}](<${source.url.replace(/[<>\s]/g, encodeURIComponent)}>)`
  }).replace(/\uE002(\d+)\uE003/g, (_tag, id) => stored[Number(id)])
}

/** Only explicit citations in the answer justify displaying a consulted source. */
export function getCitedSources<T extends CitationSource>(text: string, sources: T[] = []): T[] {
  const prose = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '')
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).filter((_, index) => index % 2 === 0).join(' ')
  const indexes = new Set([...prose.matchAll(/(?<!!)\[(\d+)\](?!\(|\[(?!\d+\])|:)/g)].map((match) => Number(match[1])))
  const urls = new Set([...prose.matchAll(/(?<!!)\[[^\]\n]+\]\(<?(https?:\/\/[^\s<>]+?)>?(?:\s+"[^"]*")?\)/g)].map((match) => match[1]))
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (!/^https?:\/\//i.test(source.url) || seen.has(source.url)) return false
    if (!indexes.has(source.index) && !urls.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

/** Resolve prose citations only against sources actually supplied to this turn. */
export function formatCitations(text: string, sources: CitationSource[] = []) {
  // Preserve fenced/inline code, existing links and Markdown reference definitions.
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, index) => {
    if (index % 2) return part
    // Remove the redundant wrapper only when its contents are citation tokens/links.
    const citation = String.raw`(?:\[\d+\]|\[[^\]\n]+\]\(<?https?:\/\/[^\s)]+>?\))`
    const wrapper = new RegExp(String.raw`\(\s*(?:sources?\s*:?\s*)?(${citation}(?:\s*[,;]?\s*${citation})*)\s*\)`, 'gi')
    const resolved = part.replace(wrapper, '$1').replace(/(?<!!)\[(\d+)\](?!\(|\[(?!\d+\])|:)/g, (_match, value) => {
      const source = sources.find((item) => item.index === Number(value) && /^https?:\/\//i.test(item.url))
      if (!source) return ''
      const label = source.domain.replace(/[\[\]\\]/g, '')
      return `[${label}](<${source.url.replace(/[<>\s]/g, encodeURIComponent)}>)`
    })
    return placeCitations(resolved, sources)
  }).join('')
}
