// Browser inference budgets, deliberately below the model's theoretical context.
export const MAX_TEXT_PROMPT_TOKENS = 4096
export const MAX_VISION_PROMPT_TOKENS = 3072

export function boundedImageSize(width: number, height: number) {
  const scale = Math.min(1, Math.sqrt((640 * 640) / (width * height)), 1024 / Math.max(width, height))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

// Count processed input IDs, including image tokens, before allocating GPU buffers.
export async function fitVisionContext<T extends { role: string }, R>(
  messages: T[],
  prepare: (messages: T[]) => Promise<{ value: R; tokens: number }>,
  dispose: (value: R) => Promise<void>,
) {
  const system = messages[0]?.role === 'system' ? messages.slice(0, 1) : []
  let turns = messages.slice(system.length)
  let dropped = 0
  for (;;) {
    const prepared = await prepare([...system, ...turns])
    if (Number.isInteger(prepared.tokens) && prepared.tokens > 0 && prepared.tokens <= MAX_VISION_PROMPT_TOKENS) {
      return { ...prepared, dropped }
    }
    await dispose(prepared.value)
    if (!Number.isInteger(prepared.tokens) || prepared.tokens <= 0) {
      throw new Error("Le modèle n'a pas pu préparer le message et son image. Réessayez avec une autre image.")
    }
    const nextUser = turns.findIndex((turn, i) => i > 0 && turn.role === 'user')
    if (nextUser < 0) {
      throw new Error("Ce message avec image est trop volumineux pour le GPU du navigateur. Raccourcissez le texte ou le document joint.")
    }
    dropped += nextUser
    turns = turns.slice(nextUser)
  }
}

export function inferenceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Buffer size.*exceeds.*(?:max buffer|max storage buffer)|(?:out of memory|allocation failed)/i.test(message)) {
    return "Le navigateur n'a pas pu réserver assez de mémoire graphique pour cette réponse. Essayez un message ou un document plus court, ou une nouvelle conversation. Si l'erreur persiste, rechargez l'extension."
  }
  return message
}
