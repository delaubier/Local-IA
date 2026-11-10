import { LogitsProcessor, LogitsProcessorList, Tensor } from '@huggingface/transformers'
import { ThinkingBudget } from './thinkingBudget'

type Options = {
  promptLength: number
  opening: number[]
  closing: number[]
  endTokens: number[]
  initiallyThinking: boolean
  enabled: boolean
}

export function createReasoningProcessor(options: Options, now = () => performance.now()) {
  const { promptLength, opening, closing, endTokens, initiallyThinking, enabled } = options
  const budget = new ThinkingBudget(opening, closing, initiallyThinking, enabled)
  class ReasoningProcessor extends LogitsProcessor {
    _call(inputIds: bigint[][], logits: Tensor): Tensor {
      const forced = budget.next(inputIds[0].slice(promptLength), now())
      const scores = logits.data as Float32Array
      if (forced !== undefined) {
        if (forced < 0 || forced >= scores.length) throw new Error('Invalid reasoning delimiter token')
        scores.fill(-Infinity)
        scores[forced] = 0
      } else if (budget.thinking) {
        for (const id of endTokens) scores[id] = -Infinity
      } else if (opening.length === 1) {
        scores[opening[0]] = -Infinity
      }
      // Transformers chains the RETURN VALUE into the next processor/sampler.
      // In-place mutation alone leaves next_tokens_scores undefined.
      return logits
    }
  }
  const processors = new LogitsProcessorList()
  processors.push(new ReasoningProcessor())
  return processors
}
