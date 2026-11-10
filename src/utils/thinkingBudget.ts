export const THINKING_TOKEN_BUDGET = 384
export const THINKING_TIME_BUDGET_MS = 12_000

/** Token-level boundary control: close reasoning without stopping answer generation. */
export class ThinkingBudget {
  private seen = 0
  private tail: number[] = []
  private tokens = 0
  private startedAt: number | undefined
  private forced: number[] = []
  private opening: number[]
  private closing: number[]
  private enabled: boolean
  private tokenBudget: number
  private timeBudget: number
  thinking: boolean

  constructor(
    opening: number[],
    closing: number[],
    initiallyThinking: boolean,
    enabled: boolean,
    tokenBudget = THINKING_TOKEN_BUDGET,
    timeBudget = THINKING_TIME_BUDGET_MS,
  ) {
    if (!opening.length || !closing.length) throw new Error('Missing reasoning delimiters')
    this.thinking = initiallyThinking
    this.opening = opening
    this.closing = closing
    this.enabled = enabled
    this.tokenBudget = tokenBudget
    this.timeBudget = timeBudget
  }

  next(generatedIds: ArrayLike<number | bigint>, now: number): number | undefined {
    for (; this.seen < generatedIds.length; this.seen++) {
      const token = Number(generatedIds[this.seen])
      this.tail.push(token)
      this.tail = this.tail.slice(-Math.max(this.opening.length, this.closing.length))
      if (this.thinking) this.tokens++
      if (this.endsWith(this.closing)) this.thinking = false
      else if (this.endsWith(this.opening)) this.thinking = true
    }
    if (this.forced.length) return this.forced.shift()
    if (!this.thinking) return undefined
    this.startedAt ??= now
    if (!this.enabled || this.tokens >= this.tokenBudget || now - this.startedAt >= this.timeBudget) {
      this.forced = [...this.closing]
      return this.forced.shift()
    }
    return undefined
  }

  private endsWith(sequence: number[]) {
    return this.tail.length >= sequence.length && sequence.every((id, i) => this.tail[this.tail.length - sequence.length + i] === id)
  }
}

export function promptStartsThinking(prompt: string) {
  return prompt.lastIndexOf('<think>') > prompt.lastIndexOf('</think>')
}

export function hasFinalAnswer(text: string) {
  return Boolean(text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').replace(/<\|[^|>]*\|>/g, '').trim())
}

export function hasUsableAnswer(text: string, allowTools: boolean) {
  const answer = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '')
    .replace(/<\|[^|>]*\|>/g, '').trim()
  if (!answer) return false
  const tool = /\[(?:WEB_SEARCH|TOOL:PAGE|TOOL:SCREEN|TOOL:AUDIO|TOOL:WEB)(?:\s*:[^\]]*)?\]/i
  const prose = answer.replace(new RegExp(tool.source, 'gi'), '').trim()
  if (tool.test(answer) && !prose) return allowTools
  // These isolated sentence starts are not a completed answer. Keep legitimate
  // concise answers (numbers, Oui/Non, names, etc.) instead of a length cutoff.
  return !/^(?:v|vo|l|la|le|les|je|the|i)[.!…\s]*$/i.test(prose)
}
