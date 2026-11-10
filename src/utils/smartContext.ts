// Analyse locale de gros PDF et fichiers de code avec extraction de structure (AST léger / TOC)
// et sélection des passages les plus pertinents par score BM25 / TF-IDF en mémoire.

export const ACCEPTED_FILE_EXTENSIONS =
  'image/*,.pdf,.txt,.md,.markdown,.rst,.csv,.tsv,.log,.json,.jsonl,.yaml,.yml,.toml,.ini,.env,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rs,.go,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cc,.cs,.php,.rb,.lua,.pl,.r,.sql,.sh,.bash,.zsh,.ps1,.bat,.dockerfile,.vue,.svelte'

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'rb', 'lua', 'pl', 'r', 'sql',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'vue', 'svelte', 'css', 'scss', 'less', 'html', 'htm',
])

export interface SmartAttachment {
  id: string
  fileName: string
  type: 'image' | 'text' | 'pdf' | 'code'
  content: string
  outline?: string
  pageCount?: number
  lineCount?: number
  estimatedTokens?: number
}

export interface SmartContextResult {
  contextText: string
  wasRagApplied: boolean
  selectedChunks: number
  totalChunks: number
  estimatedTokens: number
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.8)
}

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : ''
}

export function isCodeFileName(fileName: string): boolean {
  return CODE_EXTENSIONS.has(getFileExtension(fileName))
}

/**
 * Extrait un squelette structurel (AST léger par expressions régulières) d'un fichier de code :
 * imports, exports, classes, interfaces, types, fonctions, méthodes, structs, traits, etc.
 */
export function extractCodeOutline(code: string, fileName: string): {
  outline: string
  lineCount: number
  estimatedTokens: number
} {
  const lines = code.split(/\r?\n/)
  const lineCount = lines.length
  const estimatedTokens = estimateTokenCount(code)
  const ext = getFileExtension(fileName)

  const signaturePatterns: RegExp[] = [
    // TypeScript / JavaScript
    /^\s*(export\s+)?(default\s+)?(abstract\s+)?(class|interface|type|enum)\s+[A-Za-z0-9_$]+/,
    /^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*[A-Za-z0-9_$]+\s*[<(]/,
    /^\s*(export\s+)?(const|let|var)\s+[A-Za-z0-9_$]+\s*(?::[^=]+)?=\s*(async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/,
    /^\s*(public|private|protected|static|async|readonly)\s+[A-Za-z0-9_$]+\s*\([^;]*\)\s*(?::\s*[^{]+)?\{/,
    /^\s*import\s+.+\s+from\s+['"][^'"]+['"]/,
    // Python
    /^\s*(async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/,
    /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*[:(]/,
    // Rust / Go / C / C++ / Java / C# / PHP / Ruby / SQL
    /^\s*(pub(?:\([^)]*\))?\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod|type)\s+[A-Za-z_][A-Za-z0-9_]*/,
    /^\s*func\s+(?:\([^)]+\)\s*)?[A-Za-z_][A-Za-z0-9_]*\s*\(/,
    /^\s*type\s+[A-Za-z_][A-Za-z0-9_]*\s+(struct|interface)\b/,
    /^\s*(CREATE|ALTER|DROP)\s+(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX)\s+/i,
  ]

  const imports: string[] = []
  const symbols: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue
    }
    if (/^(import\s|from\s+\S+\s+import\s|use\s+\S+|#include\s|require\()/.test(trimmed)) {
      if (imports.length < 15) {
        imports.push(`L${i + 1}: ${trimmed.slice(0, 110)}`)
      }
      continue
    }
    for (const pat of signaturePatterns) {
      if (pat.test(raw)) {
        const cleanSig = trimmed.replace(/\{\s*$/, '').trim().slice(0, 120)
        symbols.push(`L${i + 1}: ${cleanSig}`)
        break
      }
    }
    if (symbols.length >= 80) break
  }

  const parts: string[] = [
    `Fichier: ${fileName} (${ext || 'texte'} · ${lineCount} lignes · ~${estimatedTokens} tokens)`,
  ]
  if (imports.length > 0) {
    parts.push(`Imports principaux (${imports.length}):\n  ` + imports.slice(0, 10).join('\n  '))
  }
  if (symbols.length > 0) {
    parts.push(`Squelette structurel (${symbols.length} déclarations):\n  ` + symbols.join('\n  '))
  }
  return {
    outline: parts.join('\n'),
    lineCount,
    estimatedTokens,
  }
}

/**
 * Formate les pages extraites d'un PDF et construit un sommaire automatique des titres/sections détectés.
 */
export function buildStructuredPdfDocument(
  fileName: string,
  pages: { pageNumber: number; text: string }[],
): {
  fullText: string
  outline: string
  pageCount: number
  estimatedTokens: number
} {
  const pageCount = pages.length
  const headings: string[] = []
  const formattedPages: string[] = []

  const headingRegex =
    /^(?:(?:chapitre|chapter|section|partie|part|annexe|appendix)\s+[0-9IVXLCDM]+|(?:[0-9]{1,2}(?:\.[0-9]{1,2}){0,3})[\s.)-]+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][^\n]{3,80}|[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ0-9\s,'’-]{5,70})$/i

  for (const p of pages) {
    const cleanPage = p.text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    formattedPages.push(`[Page ${p.pageNumber}/${pageCount}]\n${cleanPage}`)

    const lines = cleanPage.split('\n')
    for (const line of lines.slice(0, 25)) {
      const candidate = line.trim()
      if (candidate.length >= 5 && candidate.length <= 90 && headingRegex.test(candidate)) {
        headings.push(`[Page ${p.pageNumber}] ${candidate}`)
        if (headings.length >= 45) break
      }
    }
  }

  const fullText = formattedPages.join('\n\n')
  const estimatedTokens = estimateTokenCount(fullText)

  const outlineParts = [
    `Document PDF: ${fileName} (${pageCount} pages · ~${estimatedTokens} tokens)`,
  ]
  if (headings.length > 0) {
    outlineParts.push(`Sommaire / Sections détectées:\n  ` + headings.slice(0, 35).join('\n  '))
  }

  return {
    fullText,
    outline: outlineParts.join('\n'),
    pageCount,
    estimatedTokens,
  }
}

// ─── Indexation & Recherche Locale BM25 en mémoire ───

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'et', 'ou', 'mais',
  'donc', 'or', 'ni', 'car', 'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'en',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ton', 'son', 'notre', 'votre', 'leur', 'je', 'tu',
  'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'qui', 'que', 'quoi', 'dont', 'ou',
  'est', 'sont', 'etre', 'avoir', 'fait', 'faire', 'plus', 'moins', 'tres', 'tout', 'tous',
  'toute', 'toutes', 'comme', 'si', 'ne', 'pas', 'y', 'a', 'l', 'qu', 's', 'c', 'j', 'm', 'n',
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'this', 'that', 'these', 'those', 'it', 'its', 'what', 'which', 'who', 'how',
])

function tokenizeForBm25(text: string): string[] {
  // Sépare aussi le camelCase et snake_case pour bien indexer les identifiants de code
  const expanded = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const rawTokens = expanded.match(/[a-z0-9]{2,}/g) ?? []
  return rawTokens.filter((t) => !STOP_WORDS.has(t))
}

interface TextChunk {
  index: number
  header: string
  content: string
  tokens: string[]
  estimatedTokens: number
}

function splitIntoChunks(att: SmartAttachment): TextChunk[] {
  const chunks: TextChunk[] = []

  if (att.type === 'pdf') {
    // Découpage par page (et sous-blocs si une page est très dense)
    const rawPages = att.content.split(/(?=\[Page \d+\/\d+\])/)
    let idx = 0
    for (const rawPage of rawPages) {
      const trimmed = rawPage.trim()
      if (!trimmed) continue
      const match = trimmed.match(/^(\[Page \d+\/\d+\])\s*([\s\S]*)$/)
      const pageHeader = match ? match[1] : `[Extrait ${idx + 1}]`
      const body = match ? match[2].trim() : trimmed
      if (!body) continue

      const maxCharsPerChunk = 1800
      if (body.length <= maxCharsPerChunk) {
        chunks.push({
          index: idx++,
          header: `${att.fileName} ${pageHeader}`,
          content: `${pageHeader}\n${body}`,
          tokens: tokenizeForBm25(body),
          estimatedTokens: estimateTokenCount(body) + 8,
        })
      } else {
        const paragraphs = body.split(/\n{2,}/)
        let buffer = ''
        let part = 1
        for (const para of paragraphs) {
          if (buffer.length + para.length > maxCharsPerChunk && buffer.length > 0) {
            const chunkText = `${pageHeader} (partie ${part++})\n${buffer.trim()}`
            chunks.push({
              index: idx++,
              header: `${att.fileName} ${pageHeader} p.${part - 1}`,
              content: chunkText,
              tokens: tokenizeForBm25(buffer),
              estimatedTokens: estimateTokenCount(chunkText),
            })
            buffer = ''
          }
          buffer += (buffer ? '\n\n' : '') + para
        }
        if (buffer.trim()) {
          const chunkText = `${pageHeader}${part > 1 ? ` (partie ${part})` : ''}\n${buffer.trim()}`
          chunks.push({
            index: idx++,
            header: `${att.fileName} ${pageHeader}`,
            content: chunkText,
            tokens: tokenizeForBm25(buffer),
            estimatedTokens: estimateTokenCount(chunkText),
          })
        }
      }
    }
    return chunks
  }

  // Fichiers de code ou texte : découpage par blocs de lignes numérotées avec recouvrement
  const lines = att.content.split(/\r?\n/)
  const linesPerChunk = att.type === 'code' ? 65 : 55
  const overlap = 8
  let idx = 0

  for (let start = 0; start < lines.length; start += linesPerChunk - overlap) {
    const end = Math.min(lines.length, start + linesPerChunk)
    const numberedLines = lines
      .slice(start, end)
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n')
    const header = `[${att.fileName} · Lignes ${start + 1}-${end}]`
    const content = `${header}\n${numberedLines}`
    chunks.push({
      index: idx++,
      header,
      content,
      tokens: tokenizeForBm25(numberedLines),
      estimatedTokens: estimateTokenCount(content),
    })
    if (end >= lines.length) break
  }

  return chunks
}

function rankChunksBm25(chunks: TextChunk[], query: string): number[] {
  if (chunks.length === 0) return []
  const queryTokens = tokenizeForBm25(query)

  // Si la requête est générique (ex: "résume ce document", "analyse ce code"),
  // on répartit équitablement les chunks sur l'ensemble du document (début, milieu, fin).
  const genericTerms = new Set([
    'resume', 'resumer', 'synthese', 'synthetise', 'explique', 'expliquer', 'analyse',
    'analyser', 'audit', 'auditer', 'document', 'fichier', 'pdf', 'code', 'page', 'texte',
  ])
  const specificQueryTokens = queryTokens.filter((t) => !genericTerms.has(t))

  if (specificQueryTokens.length === 0) {
    // Échantillonnage stratifié couvrant le début, les sections clés et la fin
    const indices: number[] = []
    const step = Math.max(1, Math.floor(chunks.length / 12))
    for (let i = 0; i < chunks.length; i += step) indices.push(i)
    for (let i = 0; i < chunks.length; i++) {
      if (!indices.includes(i)) indices.push(i)
    }
    return indices
  }

  const N = chunks.length
  const avgdl = chunks.reduce((sum, c) => sum + c.tokens.length, 0) / Math.max(1, N)
  const k1 = 1.5
  const b = 0.75

  // Fréquence documentaire (DF) pour chaque terme de la requête
  const df = new Map<string, number>()
  for (const term of new Set(specificQueryTokens)) {
    let count = 0
    for (const chunk of chunks) {
      if (chunk.tokens.includes(term)) count++
    }
    df.set(term, count)
  }

  const scores = chunks.map((chunk, i) => {
    const tfMap = new Map<string, number>()
    for (const tok of chunk.tokens) {
      tfMap.set(tok, (tfMap.get(tok) ?? 0) + 1)
    }

    let score = 0
    const dl = chunk.tokens.length || 1
    for (const term of specificQueryTokens) {
      const tf = tfMap.get(term) ?? 0
      if (tf === 0) continue
      const n_q = df.get(term) ?? 0
      const idf = Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5))
      const num = tf * (k1 + 1)
      const denom = tf + k1 * (1 - b + b * (dl / avgdl))
      score += idf * (num / denom)
    }

    // Bonus léger pour le tout premier bloc (introduction / imports)
    if (i === 0) score += 0.35
    return { index: i, score }
  })

  scores.sort((a, b) => b.score - a.score || a.index - b.index)
  return scores.map((s) => s.index)
}

/**
 * Construit le contexte enrichi des pièces jointes (PDF, code, texte) en respectant
 * le budget de tokens disponible grâce au squelette structurel + RAG BM25 local.
 */
export function buildSmartAttachmentContext(
  attachments: SmartAttachment[],
  userQuery: string,
  maxTokenBudget = 3200,
): SmartContextResult {
  const docAttachments = attachments.filter((a) => a.type !== 'image')
  if (docAttachments.length === 0) {
    return {
      contextText: '',
      wasRagApplied: false,
      selectedChunks: 0,
      totalChunks: 0,
      estimatedTokens: 0,
    }
  }

  const separator = '\n\n====================\n\n'
  const totalCharBudget = Math.max(0, Math.floor(maxTokenBudget * 3.8))
  const perFileChars = Math.max(0, Math.floor((totalCharBudget - separator.length * (docAttachments.length - 1)) / docAttachments.length))
  const perFileBudget = Math.floor(perFileChars / 3.8)
  const sections: string[] = []
  let wasRagApplied = false
  let totalSelectedChunks = 0
  let totalAllChunks = 0
  const boundedText = (text: string, limit: number) => {
    if (text.length <= limit) return text
    const suffix = '\n[Extrait limité]'
    return limit >= suffix.length ? text.slice(0, limit - suffix.length) + suffix : text.slice(0, limit)
  }
  const appendSection = (block: string) => {
    if (block.length > perFileChars) wasRagApplied = true
    if (perFileChars > 0) sections.push(boundedText(block, perFileChars))
  }

  for (const att of docAttachments) {
    const fileTokens = att.estimatedTokens ?? estimateTokenCount(att.content)

    // Si le fichier tient intégralement dans le budget, on l'injecte au complet
    if (fileTokens <= perFileBudget) {
      const header = `[Fichier joint : ${att.fileName} · Contenu intégral (~${fileTokens} tokens)]`
      const block = att.outline
        ? `${header}\n${att.outline}\n\n--- Contenu complet ---\n${att.content}`
        : `${header}\n${att.content}`
      appendSection(block)
      totalSelectedChunks += 1
      totalAllChunks += 1
      continue
    }

    // Fichier volumineux : Squelette structurel + RAG BM25 sur les chunks
    wasRagApplied = true
    const outlineBlock = boundedText(att.outline ?? `Fichier: ${att.fileName} (~${fileTokens} tokens)`, Math.floor(perFileChars / 4))
    const outlineTokens = estimateTokenCount(outlineBlock)
    let remainingBudget = Math.max(0, perFileBudget - outlineTokens - 80)

    const chunks = splitIntoChunks(att)
    totalAllChunks += chunks.length
    const rankedIndices = rankChunksBm25(chunks, userQuery)

    const chosenIndices: number[] = []
    for (const idx of rankedIndices) {
      const c = chunks[idx]
      if (c.estimatedTokens <= remainingBudget || chosenIndices.length === 0) {
        chosenIndices.push(idx)
        remainingBudget -= c.estimatedTokens
        if (remainingBudget <= 120) break
      }
    }

    // Trie les extraits retenus dans l'ordre original du document pour préserver la cohérence
    chosenIndices.sort((a, b) => a - b)
    totalSelectedChunks += chosenIndices.length

    const selectedText = chosenIndices.map((idx) => chunks[idx].content).join('\n\n---\n\n')
    const block = [
      `[Fichier volumineux : ${att.fileName} · RAG Local BM25 (${chosenIndices.length}/${chunks.length} sections les plus pertinentes sélectionnées sur ~${fileTokens} tokens)]`,
      `=== Structure globale du document ===\n${outlineBlock}`,
      `=== Extraits pertinents (triés dans l'ordre du document) ===\n${selectedText}`,
    ].join('\n\n')

    appendSection(block)
  }

  return {
    contextText: sections.join(separator),
    wasRagApplied,
    selectedChunks: totalSelectedChunks,
    totalChunks: totalAllChunks,
    estimatedTokens: estimateTokenCount(sections.join(separator)),
  }
}
