/** Score Whisper's language tokens from the audio, before adding a language/task prefix. */
export async function detectSpokenLanguage(transcriber: any, audio: Float32Array, makeToken: (id: number) => any): Promise<string> {
  const config = transcriber.model.generation_config
  if (!config?.lang_to_id || !Number.isInteger(config.decoder_start_token_id)) throw new Error('Ce modèle ne permet pas la détection multilingue.')
  const inputs = await transcriber.processor(audio.subarray(0, 30 * 16000))
  const decoder = makeToken(config.decoder_start_token_id)
  let output: any
  try {
    output = await transcriber.model({ ...inputs, decoder_input_ids: decoder })
    const logits = output.logits
    const vocabulary = logits.dims.at(-1)
    const offset = logits.data.length - vocabulary
    let best = -Infinity, language = ''
    for (const [token, id] of Object.entries(config.lang_to_id) as [string, number][]) {
      const score = Number(logits.data[offset + id])
      if (id >= 0 && id < vocabulary && Number.isFinite(score) && score > best) { best = score; language = token.replace(/^<\||\|>$/g, '') }
    }
    if (!language) throw new Error('Impossible de détecter la langue de cet enregistrement.')
    return language
  } finally {
    const tensors = new Set<any>()
    const release = (value: any) => {
      if (!value || typeof value !== 'object' || tensors.has(value)) return
      tensors.add(value)
      if (typeof value.dispose === 'function') value.dispose()
      else for (const child of Object.values(value)) release(child)
    }
    release(inputs); release(decoder); release(output)
  }
}
