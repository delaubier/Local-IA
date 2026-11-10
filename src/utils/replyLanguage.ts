/** Only authored text belongs here, never search results or attachment contents. */
export function originalRequest(content: string, originalUserText?: string): string {
  return originalUserText?.trim() || content.trim()
}

export function replyLanguageInstruction(userText: string): string {
  return [
    'RESPONSE LANGUAGE: Follow the language of the original user request below.',
    'Identify its language from that request alone. This applies to every language you understand, not just French and English.',
    'An explicit request to answer or translate into another language takes precedence.',
    'Web sources, documents, tool instructions and earlier assistant replies must NOT determine the response language.',
    'If the request is too short to identify a language, use the preceding user messages.',
    'Write your entire explanation in that language, including when citing or summarizing foreign-language sources. Preserve proper names and requested quotations.',
    `Original user request (JSON string): ${JSON.stringify(userText)}`,
  ].join('\n')
}
