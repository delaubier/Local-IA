/** A tool call is a command at the start, never a tag quoted in a visible answer. */
export function initialToolCall(text: string): { type: 'web' | 'page' | 'screen' | 'audio'; query?: string } | null {
  const answer = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trimStart()
  const match = answer.match(/^\[(WEB_SEARCH|TOOL:WEB|TOOL:PAGE|TOOL:SCREEN|TOOL:AUDIO)(?:\s*:\s*([^\]\n]+))?\]/i)
  if (!match) return null
  const name = match[1].toUpperCase()
  const type = name === 'WEB_SEARCH' || name === 'TOOL:WEB' ? 'web' : name.slice(5).toLowerCase() as 'page' | 'screen' | 'audio'
  return { type, ...(match[2]?.trim() ? { query: match[2].trim() } : {}) }
}
