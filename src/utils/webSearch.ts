// Recherche et lecture directe depuis le navigateur, avec fournisseurs facultatifs.
// Tirant parti de la permission `host_permissions: ["<all_urls>"]` de l'extension Chrome :
// 1. Détection et lecture automatique des URL collées dans le chat (`https://...`)
// 2. Recherche Web multi-sources (DuckDuckGo HTML, Wikipedia API FR/EN, Brave Search HTML)
// 3. Extraction DOM propre des meilleures pages en parallèle + filtrage BM25

import type { SmartAttachment } from './smartContext'
import { detectTextLanguage } from './localAudio'
import { Readability } from '@mozilla/readability'
import { canonicalWebUrl, rankWebSources, buildWebEvidence, selectPageLinks, pageMatchesQuery, searchTerms, type EvidenceSource, type PageLink } from './webEvidence'
import { isAssistantIdentityQuestion, followUpSite, topicHistory } from './conversationContext'
import { initialToolCall } from './toolCall'
import { presidentialQuestionLanguage } from './electionScope'

export interface WebSearchSource extends EvidenceSource {
  index: number
  title: string
  url: string
  domain: string
  snippet: string
  fullText?: string
}

export interface WebSearchOutcome {
  query: string
  sources: WebSearchSource[]
  contextHeader: string
  evidence: { instructions: string; blocks: string[] }
  attachments: SmartAttachment[]
}

const FETCH_TIMEOUT_MS = 5500

// Keep the deadline active while reading the body, not only until headers arrive.
export async function fetchWebText(url: string, timeoutMs = FETCH_TIMEOUT_MS, options: RequestInit = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Page vide')
    const decoder = new TextDecoder()
    let text = ''
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 2_000_000) { await reader.cancel(); break }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally { reader.releaseLock() }
    return { text, contentType: response.headers.get('content-type') || '' }
  } finally { clearTimeout(timer) }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(options.headers || {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

export type AutoToolType = 'page' | 'screen' | 'audio' | 'web' | null

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>")\]']+/gi) || []
  const cleaned = matches.map((u) => u.replace(/[.,;:!?)]+$/, ''))
  return Array.from(new Set(cleaned)).slice(0, 4)
}

/**
 * Détecte automatiquement quel outil local doit être appelé selon le message de l'utilisateur :
 * - `'audio'` : l'utilisateur parle de la vidéo / du son / de YouTube sur son onglet
 * - `'screen'` : l'utilisateur parle d'un élément visuel à l'écran (graphique, schéma, image, design/UI)
 * - `'page'` : l'utilisateur demande de l'aide, un résumé ou une explication sur la page web ouverte
 * - `'web'` : l'utilisateur colle une URL ou pose une question nécessitant une recherche Internet
 */
export function detectAutoToolIntent(
  userQuery: string,
  hasAttachments = false,
  webSearchEnabled = true,
): AutoToolType {
  const q = userQuery.trim()
  if (!q) return null
  if (isAssistantIdentityQuestion(q)) return null

  const lower = q.toLowerCase()

  // Si une URL est collée explicitement dans le message -> lecture Web de cette URL
  if (extractUrlsFromText(q).length > 0) return 'web'

  // Si l'utilisateur a déjà joint un fichier/image manuellement, on ne déclenche que s'il demande explicitement un outil Web
  if (hasAttachments) {
    if (
      /\b(cherche sur internet|recherche sur le web|sur internet|wikip[eé]dia|site officiel|search the web|search online|on the web|busca en internet)\b/i.test(
        lower,
      )
    ) {
      return 'web'
    }
    return null
  }

  // 1. Outil AUDIO / VIDÉO de l'onglet (`extractActiveTabAudioTranscript`) — Multilingue
  if (
    /\b(cette vid[eé]o|la vid[eé]o|ma vid[eé]o|ce youtube|la vid[eé]o youtube|ce podcast|le podcast|l['’]audio de l['’]onglet|le son de l['’]onglet|les sous[- ]titres|transcri(?:s|re|ption|be)|que dit[- ]il dans la vid[eé]o|r[eé]sume(?:r)? la vid[eé]o|de quoi parle la vid[eé]o|[eé]coute(?:r)? (?:l['’]onglet|la vid[eé]o)|this video|the video|this podcast|tab audio|video transcript|summarize (?:this|the) video|este video|el video)\b/i.test(
      lower,
    )
  ) {
    return 'audio'
  }

  // 2. Outil ÉCRAN / VISION (`captureActiveTabScreenshot`) — Multilingue
  if (
    /\b(mon [eé]cran|l['’][eé]cran|sur l['’][eé]cran|[aà] l['’][eé]cran|capture(?:r)? (?:l['’])?[eé]cran|ce graphique|le graphique|cette courbe|la courbe|ce sch[eé]ma|le sch[eé]ma|ce diagramme|le diagramme|cette image|l['’]image affich[eé]e|cette photo|que vois[- ]tu|regarde (?:mon|l['’]|ce)|probl[eè]me d['’]affichage|bug d['’]affichage|d[eé]bug(?:ger|gue)? (?:l['’])?(?:ui|interface|[eé]cran)|analyse(?:r)? (?:l['’])?(?:ui|interface|design)|tradui(?:s|re) (?:l['’][eé]cran|ce qui est affich[eé]|cette image)|my screen|on screen|this chart|the chart|this graph|this diagram|what do you see|screenshot|debug (?:this )?ui|translate screen|mi pantalla|este gr[aá]fico)\b/i.test(
      lower,
    )
  ) {
    return 'screen'
  }

  // 3. Outil PAGE WEB ACTIVE (`extractActiveTabContent`) — Multilingue
  if (
    /\b(cette page|la page|ma page|sa page|cet onglet|l['’]onglet|ce site|le site|cet article|l['’]article|ce post|ce blog|cette documentation|la doc|ce cours|ce formulaire|cette s[eé]lection|le texte s[eé]lectionn[eé]|ce passage|ce que je lis|sur cette page|dans cette page|de la page|aide[- ]moi (?:sur|avec|pour|ici)|explique[- ]moi (?:ça|ceci|cette page|cet article|ce site)|r[eé]sume[- ]moi (?:ça|ceci|cette page|cet article)|traduis (?:cette page|cet article|la page)|qu['’]est[- ]ce qui est [eé]crit|de quoi (?:ça )?parle ici|this page|the page|this tab|this site|this website|this article|summarize (?:this|the) (?:page|article|tab)|help me (?:with|on) this page|esta p[aá]gina|este art[ií]culo|diese seite)\b/i.test(
      lower,
    ) ||
    /^(r[eé]sume|r[eé]sumer|r[eé]sume ça|explique ça|traduis ça|analyse ça|summarize|summarize this|explain this|translate this)[.!?]*$/i.test(
      lower,
    )
  ) {
    return 'page'
  }

  // 4. Outil RECHERCHE INTERNET (`performWebResearch`)
  if (webSearchEnabled && shouldTriggerWebSearch(q, hasAttachments)) {
    return 'web'
  }

  return null
}

/**
 * Extrait la requête personnalisée demandée par le modèle :
 * - soit via la balise `[WEB_SEARCH: ma requête]` / `[TOOL:WEB: ma requête]`
 * - soit si le modèle annonce en français « Je vais effectuer une recherche ... sur "Nom" »
 */
export function extractModelWebSearchQuery(rawResponse: string): string | null {
  const command = initialToolCall(rawResponse)
  return command?.type === 'web' ? command.query ?? null : null
}

/**
 * Détecte si le modèle LFM3 demande lui-même l'appel d'un outil via une balise (`[TOOL:PAGE]`, `[TOOL:SCREEN]`,
 * `[TOOL:AUDIO]`, `[WEB_SEARCH]`, `[WEB_SEARCH: requête]`) ou s'il indique ne pas connaître la réponse
 * ou s'arrête en annonçant qu'il "va effectuer une recherche".
 */
export function detectModelToolCall(rawResponse: string, allowUncertaintyWeb = false): AutoToolType {
  if (!rawResponse) return null
  const command = initialToolCall(rawResponse)
  if (command) return command.type
  if (allowUncertaintyWeb && detectModelUncertainty(rawResponse)) return 'web'
  return null
}

/**
 * Détermine automatiquement si la question de l'utilisateur nécessite un accès à Internet
 * (étape 1 : déclenchement proactif avant la génération).
 */
export function shouldTriggerWebSearch(userQuery: string, hasAttachments = false): boolean {
  const q = userQuery.trim()
  if (!q) return false
  if (isAssistantIdentityQuestion(q)) return false

  // 1. Toute URL collée déclenche immédiatement la lecture Web
  if (extractUrlsFromText(q).length > 0) return true

  const lower = q.toLowerCase()

  // Conversational help and editing must not send unrelated queries to a search engine.
  if (/^(?:bonjour|salut|hello|hey|hi|coucou|bonsoir)[!,.\s]*(?:(?:comment|en quoi) (?:peux[- ]tu|tu peux|pouvez[- ]vous) (?:m['’]aider|m['’][eê]tre utile)|comment (?:ça va|vas[- ]tu))?[!?.\s]*$/i.test(q)) return false
  if (isGeneralDefinition(q)) return false
  const explicitWeb = /(?:sur internet|sur le web|cherche|recherche|site officiel|search (?:online|the web)|look up)/i.test(q)
  if (!explicitWeb && /^(?:traduis|traduire|corrige|corriger|reformule|reformuler|r[eé]sume ce texte|[eé]cris|r[eé]dige|translate|rewrite|proofread|write|explain this code)\b/i.test(q)) return false

  // 2. Mots-clés explicites de recherche Web (Multilingue : FR, EN, ES, DE, IT)
  if (
    /\b(cherche|recherche|rechercher|chercher|trouve|trouver|internet|sur le web|wikip[eé]dia|google|source officielle|site officiel|actualit[eé]s?|search|find online|look up|on the web|news|buscar|noticias|suche)\b/i.test(
      lower,
    )
  ) {
    return true
  }

  // Si l'utilisateur travaille déjà sur un document joint (PDF/Code/Image), on reste sur son document par défaut
  if (hasAttachments) return false

  // 3. Salutations courtes, remerciements ou méta-questions sur l'assistant -> 100 % local instantané
  if (
    q.length < 18 &&
    /^(bonjour|salut|hello|hey|hi|coucou|bonsoir|merci|thanks|thank you|ok|okay|d'accord|super|parfait|ça va|comment ça va|how are you|qui es[- ]tu|tu es qui|who are you|hola|gracias|hallo|danke)\b/i.test(
      lower,
    )
  ) {
    return false
  }

  // 4. Marqueurs temporels, temps réel, actualités, prix, météo, résultats, versions (Multilingue)
  if (
    /\b(aujourd['’]hui|hier|demain|cette semaine|ce mois|cette ann[eé]e|202[4-9]|203\d|actuel(?:le|lement|s)?|maintenant|en ce moment|r[eé]cent(?:e|s)?|derni[eè]re?s?|nouveau|nouvelle|mise [aà] jour|version|m[eé]t[eé]o|prix|tarif|cours|bourse|bitcoin|crypto|score|r[eé]sultat|match|classement|horaire|horaires|date de sortie|today|yesterday|tomorrow|current|currently|latest|recent|weather|price|stock|release date|hoy|precio|clima|heute|aktuell|wetter|preis)\b/i.test(
      lower,
    )
  ) {
    return true
  }

  // 5. Questions factuelles, encyclopédiques, géographiques, historiques ou sur des personnes/entreprises/produits (Multilingue)
  if (presidentialQuestionLanguage(q)) return true
  if (
    /\b(qui est|qui sont|qui a |qu['’]est[- ]ce que|c['’]est quoi|o[uù] se trouve|o[uù] est|quand a |quand est|combien co[uû]te|combien d['’e]|quel est|quelle est|quels sont|quelles sont|capitale|pr[eé]sident|ministre|gouvernement|maire|pdg|fondateur|dirigeant|entreprise|soci[eé]t[eé]|population|superficie|histoire de|biographie|film|s[eé]rie|album|chanson|jeu|loi|article de loi|who is|who are|what is|where is|when did|when was|how much|how many|president|ceo|founder|company|capital of|qui[eé]n es|qu[eé] es|d[oó]nde est[aá]|wer ist|was ist|wo ist)\b/i.test(
      lower,
    )
  ) {
    return true
  }

  // 6. Tâches purement rédactionnelles, de traduction, de correction ou de génération de code locale
  if (
    /^(traduis|traduire|corrige|corriger|reformule|reformuler|r[eé]sume ce texte|[eé]cris un po[eè]me|[eé]cris une fonction|[eé]cris un script|code en |cr[eé]e une fonction|explique ce code|debug ce code|translate|rewrite|proofread|write a poem|write a function|explain this code)\b/i.test(
      lower,
    )
  ) {
    return false
  }

  // 7. Présence d'un nom propre (mot avec majuscule après le premier mot) ou d'un point d'interrogation sur une question de > 20 caractères
  const words = q.split(/\s+/)
  const hasProperNoun = words.slice(1).some((w) => /^[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][a-zàâäéèêëîïôöùûüç0-9_-]{2,}/.test(w))
  if (hasProperNoun) return true

  // Punctuation alone does not justify research. For other requests the model can
  // request a tool before answering, without replacing an already visible answer.

  return false
}

export function isGeneralDefinition(query: string): boolean {
  const nounPhrase = query.trim().match(/^(?:qu['’]est[- ]ce qu['’](?:un|une)|c['’]est quoi (?:un|une)|what is (?:a|an))\s+(.+?)[?.!]*$/i)?.[1]
  return !!nounPhrase && nounPhrase.split(/\s+/).length <= 6 &&
    !/\b(?:good|best|nearest|cheapest|meilleur\w*|prix|bon(?:ne)?|recommand\w*|actuel\w*|current\w*|20\d{2}|internet|web|source officielle|avec (?:des|une) sources?|with sources)\b/i.test(nounPhrase)
}

/**
 * Détecte si la réponse générée par le modèle indique qu'il ne connaît pas la réponse,
 * qu'il prétend ne pas avoir accès à Internet, qu'il demande `[WEB_SEARCH]`,
 * OU qu'il s'arrête après avoir annoncé « Je vais effectuer une recherche... / I will search... » sans donner la réponse.
 */
export function detectModelUncertainty(rawResponse: string): boolean {
  if (!rawResponse) return false
  if (/\[(?:WEB_SEARCH|TOOL:WEB)(?:\s*:[^\]]*)?\]/i.test(rawResponse)) return true

  const clean = rawResponse.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim()
  if (!clean) return false

  const uncertaintyPatterns = [
    // Le modèle annonce qu'il va chercher mais s'arrête sans répondre (FR + EN + ES + DE)
    /je vais (?:effectuer|faire|lancer) une recherche/i,
    /je vais (?:chercher|rechercher|v[eé]rifier) (?:sur|dans|en|le nom|les informations)/i,
    /laisse(?:z)?[- ]moi (?:effectuer une recherche|chercher|rechercher|v[eé]rifier)/i,
    /effectuons une recherche/i,
    /\bi (?:will|am going to) (?:perform a )?search\b/i,
    /\blet me (?:search|look up|check)\b/i,
    /\bvoy a (?:realizar una b[uú]squeda|buscar)\b/i,
    // Le modèle prétend ne pas avoir accès à Internet ou ne pas savoir (FR + EN + Multilingue)
    /n['’]ai pas acc[eè]s (?:[aà] internet|au web|aux informations|en temps r[eé]el|aux donn[eé]es)/i,
    /pas acc[eé]der [aà] internet/i,
    /acc[eè]s [aà] internet en temps r[eé]el/i,
    /ne peux pas r[eé]cup[eé]rer/i,
    /ne dispose pas (?:d['’]informations|de donn[eé]es|d['’]acc[eè]s|des informations)/i,
    /mes connaissances (?:s['’]arr[eê]tent|sont limit[eé]es)/i,
    /date de coupure/i,
    /je ne (?:connais|sais) pas (?:exactement|pr[eé]cis[eé]ment|qui|quel|quelle|quand|o[uù]|combien|la r[eé]ponse|ce que|cette)/i,
    /je ne sais pas\b/i,
    /je n['’]ai pas (?:cette information|l['’]information|la r[eé]ponse|assez d['’]informations|d['’]informations? (?:sur|pr[eé]cises|r[eé]centes|[aà] ce sujet))/i,
    /impossible de (?:v[eé]rifier|confirmer|r[eé]pondre|conna[iî]tre|savoir|vous donner|r[eé]cup[eé]rer)/i,
    /ne peux pas (?:v[eé]rifier|acc[eé]der|consulter|fournir|confirmer|vous donner|r[eé]pondre avec certitude|chercher sur internet)/i,
    /pas en mesure de (?:fournir|v[eé]rifier|confirmer|r[eé]pondre|conna[iî]tre|savoir|r[eé]cup[eé]rer)/i,
    /en tant qu['’](?:ia|intelligence artificielle|assistant|mod[eè]le de langage)/i,
    /consulter (?:un moteur de recherche|internet|le web|des sources|un site)/i,
    /pas d['’]informations? (?:disponibles?|fiables?|r[eé]centes?|[aà] jour)/i,
    /\b(?:do not|don['’]t|cannot|can['’]t) have access to (?:the internet|real[- ]time)/i,
    /\bi (?:do not|don['’]t) know\b/i,
    /\bmy knowledge cutoff\b/i,
    /\bas an ai\b/i,
  ]

  return uncertaintyPatterns.some((regex) => regex.test(clean))
}

/**
 * Nettoie une phrase conversationnelle ("Je cherche son numéro..." / "Peux-tu me dire...")
 * pour en extraire des mots-clés de recherche efficaces pour les moteurs Web.
 */
export function extractSearchKeywords(rawQuery: string): string {
  const cleaned = rawQuery
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(
      /\b(peux[- ]tu|pourrais[- ]tu|est[- ]ce que tu peux|est[- ]ce que|je voudrais|j['’]aimerais|je cherche|je recherche|s['’]il te pla[iî]t|svp|stp|dis[- ]moi|donne[- ]moi|trouve[- ]moi|cherche[- ]moi|aide[- ]moi [aà]|r[eé]dige[- ]moi|r[eé]diger|formuler une requ[eê]te|[eé]crire un mail|[eé]cris un mail|quel est le|quelle est la|quels sont les|quelles sont les|peux tu me dire|connais[- ]tu|r[eé]ponds? [aà] ma question)\b/gi,
      ' ',
    )
    .replace(/[?!.;,"«»()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return rawQuery.trim()

  const stopWords = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l', 'au', 'aux',
    'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'leur', 'leurs',
    'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', 'te', 'se', 'moi', 'toi',
    'qui', 'que', 'quoi', 'dont', 'où', 'pour', 'par', 'avec', 'dans', 'sur', 'sous', 'vers',
    'et', 'ou', 'mais', 'donc', 'car', 'ni', 'comme', 'si', 'plus', 'moins', 'très', 'bien',
    'être', 'avoir', 'faire', 'dire', 'pouvoir', 'vouloir', 'savoir', 'falloir', 'devoir',
    'est', 'sont', 'ai', 'as', 'a', 'avons', 'avez', 'ont', 'actuel', 'actuelle', 'actuellement',
  ])

  const words = cleaned.split(/\s+/)
  if (words.length <= 4) return cleaned

  const kept = words.filter((w) => {
    const cleanW = w.replace(/^[ldLD]['’]/, '')
    const lowerW = cleanW.toLowerCase()
    if (lowerW.length <= 1) return false
    if (/^[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ0-9]/.test(cleanW)) return true
    return !stopWords.has(lowerW)
  })

  return (kept.length >= 2 ? kept.slice(0, 9).join(' ') : cleaned).trim()
}

export function compactWebQuery(query: string): string {
  // Only remove request framing. Preserve quoted text, years, negations and constraints.
  const compact = query.trim()
    .replace(/^(?:bon|eh bien|well),\s*/i, '')
    .replace(/^(?:prochaine question[, :]\s*|je voulais savoir\s+)/gi, '')
    .replace(/^(?:je voulais savoir\s+|(?:mais\s+)?qu['’]en est-il (?:pour|de)\s+|(?:but\s+)?what about\s+)/i, '')
    .replace(/^(?:(?:peux[- ]tu|pourrais[- ]tu|can you|could you|please|je voudrais que tu)\s+)?(?:(?:cherche(?:r)?|recherch(?:e|er)|trouv(?:e|er))(?:[- ]moi)?(?:\s+sur (?:le web|internet))?|(?:search(?: the web)? for|look up|find me)|(?:me dire|dis[- ]moi))\s+/i, '')
    .replace(/^(?:(?:quel(?:le)? est|quel(?:le)?s sont) (?:le |la |les |l['’])|what (?:is|are) the )/i, '')
  return (compact || query).replace(/\s+/g, ' ').trim().slice(0, 360)
}

/**
 * Enrichit automatiquement une question de suivi ("Je cherche son numéro Siret", "Quel est son PDG ?", "Réponds à ma question")
 * avec le sujet / les noms propres mentionnés dans les messages précédents de la conversation (ex: "Epsilon France").
 */
export function buildContextualWebQuery(
  currentQuery: string,
  history: { role: string; text: string }[],
): string {
  const q = currentQuery.trim()
  const historyMessages = topicHistory(history, q, turn => turn.text)
  if (!q || historyMessages.length === 0) return q
  if (extractUrlsFromText(q).length || isAssistantIdentityQuestion(q)) return q
  const site = followUpSite(q, historyMessages)
  if (site) return `${q}\n${site}`
  const newYear = q.match(/^(?:(?:et|and)\s+)?(?:en|in)\s+(\d{4})[\s?.!]*$/i)
  if (newYear) {
    const previous = historyMessages.findLast(message => message.role === 'user' &&
      !isAssistantIdentityQuestion(message.text) && searchTerms(message.text).some(term => !/^\d+$/.test(term) && !['in', 'then', 'alors'].includes(term)))
    if (previous && shouldTriggerWebSearch(previous.text) && !extractUrlsFromText(previous.text).length &&
      (previous.text.match(/\b\d{4}\b/g)?.length ?? 0) <= 1) {
      return `${newYear[1]} ${previous.text.replace(/\b\d{4}\b/g, '').replace(/\s+/g, ' ').trim()}`
    }
  }

  // 1. Si l'utilisateur écrit une relance comme "Réponds à ma question" ou "Alors ?",
  // on récupère la dernière vraie question posée par l'utilisateur dans l'historique.
  const isNudge =
    /^(r[eé]ponds?(?:[- ]moi)?(?: [aà] (?:ma|la) question)?|alors\s*\??|continue|et donc\s*\??|tu n['’]as pas r[eé]pondu|donne(?:[- ]moi)? la r[eé]ponse|fais[- ]le|vas[- ]y|cherche)[.!?\s]*$/i.test(
      q,
    )

  let baseQuestion = q
  if (isNudge) {
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      const m = historyMessages[i]
      if (m.role === 'user' && m.text.trim() && !/^(r[eé]ponds?|alors|continue|vas[- ]y)/i.test(m.text.trim())) {
        baseQuestion = m.text.trim()
        break
      }
    }
  }

  // 2. Vérifie si la question dépend du contexte précédent (pronoms possessifs/démonstratifs "son", "sa", "leur", "ce", "cette" ou absence de nom propre)
  const hasPronounReference =
    /\b(son|sa|ses|leur|leurs|il|elle|ils|elles|celui[- ]ci|celle[- ]ci|its|their|his|her)\b|^(?:et|and)\s/i.test(baseQuestion)
  const words = baseQuestion.split(/\s+/)
  const hasOwnProperNoun = words
    .slice(1)
    .some((w) => /^[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][a-zàâäéèêëîïôöùûüç0-9_-]{2,}/.test(w.replace(/^[ldLD]['’]/, '')))

  if (!isNudge && (!hasPronounReference || hasOwnProperNoun)) {
    return baseQuestion
  }

  // 3. Recherche le sujet principal (entité entre guillemets ou groupe de noms propres) dans les derniers messages
  const ignoredCapitalWords = new Set([
    'Bonjour', 'Salut', 'Merci', 'Oui', 'Non', 'Bien', 'Voici', 'Pour', 'Dans', 'Avec', 'Sans',
    'Mais', 'Donc', 'Comme', 'Quand', 'Quel', 'Quelle', 'Quels', 'Quelles', 'Comment', 'Pourquoi', 'Qui', 'Quoi', 'Où',
    'Who', 'What', 'Where', 'When', 'How', 'Tell', 'Can', 'Could', 'Please',
    'Note', 'Source', 'Sources', 'Web', 'Internet', 'Page', 'Résumé', 'Extrait', 'Bien sûr',
  ])

  let detectedEntity = ''

  for (let i = historyMessages.length - 1; i >= Math.max(0, historyMessages.length - 6); i--) {
    if (historyMessages[i].role !== 'user') continue
    const txt = historyMessages[i].text
    if (!txt) continue

    // Priorité A : Entité explicitement citée entre guillemets (ex: "Epsilon France")
    const quoted = txt.match(/["«]([A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][^"»\n]{2,45})["»]/)
    if (quoted && quoted[1]) {
      detectedEntity = quoted[1].trim()
      break
    }

    // Priorité B : Séquence de noms propres (1 à 3 mots avec majuscule) dans les messages précédents
    const properMatches = txt.match(
      /\b([A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][a-zàâäéèêëîïôöùûüç0-9&-]{2,}(?:\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][a-zàâäéèêëîïôöùûüç0-9&-]{1,}){0,2})\b/g,
    )
    if (properMatches) {
      const candidate = properMatches.find((m) => !ignoredCapitalWords.has(m.split(/\s+/)[0]))
      if (candidate) {
        detectedEntity = candidate.trim()
        break
      }
    }
  }

  if (detectedEntity && !baseQuestion.toLowerCase().includes(detectedEntity.toLowerCase())) {
    return `${detectedEntity} ${baseQuestion}`.trim()
  }

  return baseQuestion
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function decodeDdgUrl(rawHref: string): string {
  try {
    if (rawHref.startsWith('//')) {
      rawHref = 'https:' + rawHref
    }
    const parsed = new URL(rawHref, 'https://html.duckduckgo.com')
    const uddg = parsed.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    return parsed.href
  } catch {
    return rawHref
  }
}

/**
 * Interroge DuckDuckGo HTML (sans clé API) dans la langue de la requête et extrait les titres, URL et extraits.
 */
async function searchDuckDuckGoHtml(query: string): Promise<Omit<WebSearchSource, 'index'>[]> {
  try {
    const lang = detectTextLanguage(query)
    const klMap: Record<string, string> = {
      fr: 'fr-fr',
      en: 'us-en',
      es: 'es-es',
      de: 'de-de',
      it: 'it-it',
      pt: 'pt-pt',
      ja: 'jp-jp',
      zh: 'cn-zh',
      ru: 'ru-ru',
    }
    const kl = klMap[lang] || 'wt-wt'
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${kl}`
    const { text: html } = await fetchWebText(url)
    const doc = parseHtmlSafely(html)

    const results: Omit<WebSearchSource, 'index'>[] = []
    const nodes = doc.querySelectorAll('.result, .web-result')

    nodes.forEach((node) => {
      if (results.length >= 6) return
      const titleEl = node.querySelector('a.result__a, .result__title a') as HTMLAnchorElement | null
      const snippetEl = node.querySelector('.result__snippet, .result__extras__url')
      if (!titleEl) return

      const rawHref = titleEl.getAttribute('href') || ''
      const cleanUrl = decodeDdgUrl(rawHref)
      if (!cleanUrl.startsWith('http') || cleanUrl.includes('duckduckgo.com/y.js')) return

      const title = (titleEl.textContent || '').replace(/\s+/g, ' ').trim()
      const snippet = (snippetEl?.textContent || '').replace(/\s+/g, ' ').trim()
      if (title && cleanUrl) {
        results.push({
          title,
          url: cleanUrl,
          domain: getDomain(cleanUrl),
          snippet,
        })
      }
    })

    return results
  } catch {
    return []
  }
}

/**
 * Fallback Brave Search HTML si DuckDuckGo ne renvoie rien.
 */
async function searchBraveHtml(query: string): Promise<Omit<WebSearchSource, 'index'>[]> {
  try {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`
    const { text: html } = await fetchWebText(url)
    const doc = parseHtmlSafely(html)

    const results: Omit<WebSearchSource, 'index'>[] = []
    const anchors = doc.querySelectorAll('div.snippet a[href^="http"], div[data-type="web"] a[href^="http"]')

    anchors.forEach((a) => {
      if (results.length >= 5) return
      const href = a.getAttribute('href') || ''
      if (!href.startsWith('http') || href.includes('brave.com')) return
      const title = (a.querySelector('.title, .snippet-title')?.textContent || a.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
      const container = a.closest('div.snippet, div[data-type="web"]')
      const snippet = (container?.querySelector('.snippet-description, .generic-snippet')?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (title.length > 4 && !results.some((r) => r.url === href)) {
        results.push({
          title,
          url: href,
          domain: getDomain(href),
          snippet,
        })
      }
    })

    return results
  } catch {
    return []
  }
}

/**
 * Interroge l'API Wikipedia dans la langue détectée de la requête (fr, en, es, de, it, pt, ja, zh, ru, ar).
 */
async function searchWikipediaFr(query: string): Promise<Omit<WebSearchSource, 'index'>[]> {
  try {
    const detected = detectTextLanguage(query)
    const allowedWikiLangs = new Set(['fr', 'en', 'es', 'de', 'it', 'pt', 'ja', 'zh', 'ru', 'ar', 'ko'])
    const wikiLang = allowedWikiLangs.has(detected) ? detected : 'en'
    const wikiHost = `${wikiLang}.wikipedia.org`

    const apiUrl =
      `https://${wikiHost}/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&origin=*&srlimit=2`
    const resp = await fetchWithTimeout(apiUrl, {}, 4000)
    if (!resp.ok) return []
    const data = await resp.json()
    const items = data?.query?.search || []
    const results: Omit<WebSearchSource, 'index'>[] = []

    for (const item of items) {
      const title = item.title as string
      const rawSnippet = (item.snippet as string) || ''
      const cleanSnippet = rawSnippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim()
      const pageUrl = `https://${wikiHost}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

      // Récupère le résumé complet via l'API REST de Wikipédia
      let summaryText = cleanSnippet
      try {
        const sumResp = await fetchWithTimeout(
          `https://${wikiHost}/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
          {},
          3000,
        )
        if (sumResp.ok) {
          const sumJson = await sumResp.json()
          if (sumJson?.extract) {
            summaryText = sumJson.extract
          }
        }
      } catch {
        /* ignore */
      }

      results.push({
        title: `${title} — Wikipedia (${wikiLang.toUpperCase()})`,
        url: pageUrl,
        domain: wikiHost,
        // The REST endpoint is a summary, not the full page.
        snippet: summaryText,
      })
    }
    return results
  } catch {
    return []
  }
}

/**
 * Télécharge une page web et en extrait le contenu utile sous forme de texte/Markdown structuré.
 * Utilise DOMParser après avoir nettoyé les attributs `on*` inline pour éviter tout avertissement
 * Content Security Policy (CSP) dans `chrome://extensions` lors d'un `cloneNode`.
 */
function parseHtmlSafely(rawHtml: string): Document {
  const sanitized = rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
  const documentHtml = /<html\b/i.test(sanitized) ? sanitized : `<html><head></head><body>${sanitized}</body></html>`
  return new DOMParser().parseFromString(documentHtml, 'text/html')
}

export function extractWebPage(html: string, url: string): { title: string; markdown: string; publishedAt?: string; links?: PageLink[] } {
  const doc = parseHtmlSafely(html)
  const pageTitle = (doc.querySelector('title')?.textContent || getDomain(url)).replace(/\s+/g, ' ').trim()
  const rawDate = doc.querySelector('meta[property="article:published_time"], meta[name="date"]')?.getAttribute('content')
  const publishedAt = rawDate && rawDate.length <= 64 && !Number.isNaN(Date.parse(rawDate)) ? rawDate : undefined
  if (/^(?:just a moment|access denied|captcha|verify you are human|attention required)/i.test(pageTitle)) {
    return { title: pageTitle, markdown: '' }
  }
  // Readability extracts the article body used by Firefox Reader View.
  let articleDoc = doc
  let title = pageTitle
  const isListing = doc.querySelectorAll('article').length >= 3
  try {
    const article = isListing ? null : new Readability(doc.cloneNode(true) as Document, { charThreshold: 180, maxElemsToParse: 25000 }).parse()
    if (article?.content && (article.textContent?.length ?? 0) > 180) {
      articleDoc = parseHtmlSafely(article.content)
      title = article.title || title
    }
  } catch { /* Keep the semantic DOM fallback for non-article pages. */ }

  const root =
    (!isListing && articleDoc.querySelector('article') as HTMLElement) ||
    (articleDoc.querySelector('main') as HTMLElement) ||
    (articleDoc.querySelector('[role="main"]') as HTMLElement) ||
    articleDoc.body

  if (!root) {
    return { title: pageTitle, markdown: '' }
  }

  const noiseSelectors = [
    'script',
    'style',
    'noscript',
    'svg',
    'canvas',
    'iframe',
    'nav',
    'footer',
    'aside',
    'form',
    'header',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[aria-hidden="true"]',
    '.cookie',
    '#cookie',
    '.ad',
    '.ads',
    '.advertisement',
    '.sidebar',
    '.comments',
  ]
  root.querySelectorAll(noiseSelectors.join(',')).forEach((el) => el.remove())

  const links: PageLink[] = []
  const seenLinks = new Set<string>()
  for (const anchor of root.querySelectorAll('a[href]')) {
    try {
      const href = anchor.getAttribute('href') || ''
      if (!href || href.startsWith('#')) continue
      const linkUrl = canonicalWebUrl(new URL(href, url).href)
      const label = (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180)
      if (!linkUrl || !label || seenLinks.has(linkUrl)) continue
      seenLinks.add(linkUrl)
      links.push({ title: label, url: linkUrl,
        context: (anchor.closest('p, li, article, section')?.textContent || label).replace(/\s+/g, ' ').trim().slice(0, 500) })
      if (links.length >= 100) break
    } catch { /* Invalid or non-HTTP links cannot become research targets. */ }
  }

  const lines: string[] = []
  const blocks = root.querySelectorAll('h1, h2, h3, h4, p, li, pre, blockquote, tr')

  if (blocks.length > 0) {
    blocks.forEach((b) => {
      if (b.parentElement?.closest('li, pre, blockquote, tr')) return
      const tag = b.tagName.toLowerCase()
      const txt = tag === 'tr'
        ? Array.from(b.children, cell => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')
        : (b.textContent || '').replace(/\s+/g, ' ').trim()
      if (!txt || txt.length < 3) return
      if (tag === 'h1') lines.push(`\n# ${txt}`)
      else if (tag === 'h2') lines.push(`\n## ${txt}`)
      else if (tag === 'h3' || tag === 'h4') lines.push(`\n### ${txt}`)
      else if (tag === 'li') lines.push(`- ${txt}`)
      else if (tag === 'blockquote') lines.push(`> ${txt}`)
      else if (tag === 'pre') lines.push(`\n\`\`\`\n${(b.textContent || '').trim()}\n\`\`\`\n`)
      else lines.push(txt)
    })
  } else {
    lines.push((root.textContent || '').replace(/\s+/g, ' ').trim())
  }

  const markdown = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 100000)

  return { title, markdown, publishedAt, links }
}

const pageCache = new Map<string, { at: number; page: ReturnType<typeof extractWebPage> }>()
export async function fetchAndCleanWebPage(rawUrl: string): Promise<ReturnType<typeof extractWebPage>> {
  const url = canonicalWebUrl(rawUrl)
  if (!url) throw new Error('Adresse web non valide')
  const cached = pageCache.get(url)
  if (cached && Date.now() - cached.at < 60000) return cached.page
  const { text, contentType } = await fetchWebText(url)
  let page: ReturnType<typeof extractWebPage>
  if (/json|text\/plain|text\/markdown/i.test(contentType)) {
    page = { title: getDomain(url), markdown: text.slice(0, 100000) }
  } else if (/html|xml/i.test(contentType) || !contentType) {
    page = extractWebPage(text, url)
  } else throw new Error('Ce format de page ne peut pas être lu automatiquement.')
  if (page.markdown.length > 80) {
    if (pageCache.size >= 24) pageCache.delete(pageCache.keys().next().value!)
    pageCache.set(url, { at: Date.now(), page })
  }
  return page
}

/**
 * Exécute une recherche Web complète (ou lit les URL présentes dans le prompt),
 * récupère le contenu des meilleures pages en parallèle et prépare les pièces jointes
 * pour le moteur RAG BM25 de LocalAI.
 */
export interface ResearchProviders {
  search: (query: string) => Promise<Omit<WebSearchSource, 'index'>[]>
  fallback: (query: string) => Promise<Omit<WebSearchSource, 'index'>[]>
  encyclopedia: (query: string) => Promise<Omit<WebSearchSource, 'index'>[]>
  read: typeof fetchAndCleanWebPage
  readFallback?: (url: string) => Promise<Awaited<ReturnType<typeof fetchAndCleanWebPage>> | undefined>
  strictSearch?: boolean
}

export const defaultProviders: ResearchProviders = {
  search: searchDuckDuckGoHtml,
  fallback: searchBraveHtml,
  encyclopedia: searchWikipediaFr,
  read: fetchAndCleanWebPage,
}

export async function performWebResearch(
  userQuery: string,
  onProgress?: (status: string) => void,
  providers: ResearchProviders = defaultProviders,
  readRenderedPage?: (url: string) => Promise<Awaited<ReturnType<ResearchProviders['read']>> | undefined>,
  calendarScope?: {
    evidenceQuery: string
    acceptsSource: (source: EvidenceSource) => boolean
    isOfficialCalendar: (source: EvidenceSource) => boolean
  },
): Promise<WebSearchOutcome> {
  const directUrls = extractUrlsFromText(userQuery)
  const query = userQuery.replace(/\s+/g, ' ').trim().slice(0, 360)
  const searchQuery = compactWebQuery(query)
  const candidates: Omit<WebSearchSource, 'index'>[] = directUrls.map((url) => ({
    title: getDomain(url), url, domain: getDomain(url), snippet: '', direct: true,
  }))
  if (!directUrls.length) {
    onProgress?.('Recherche en cours…')
    const results = await Promise.allSettled([providers.search(searchQuery), providers.encyclopedia(searchQuery)])
    if (providers.strictSearch && results[0].status === 'rejected') throw results[0].reason
    for (const result of results) if (result.status === 'fulfilled') candidates.push(...result.value)
  }
  const inScope = (source: EvidenceSource) => source.direct || !calendarScope || calendarScope.acceptsSource(source)
  const ranked = rankWebSources(query, candidates.filter(inScope)).slice(0, 6)
  const visited = new Set<string>()
  const readSources = async (sources: typeof ranked) => {
    await Promise.all(sources.map(async (source) => {
      visited.add(source.url)
      let page = await providers.read(source.url).catch(() => undefined)
      if (source.direct && readRenderedPage && (!page || page.markdown.trim().length < 80)) {
        page = await readRenderedPage(source.url).catch(() => undefined)
      }
      if (providers.readFallback && (!page || page.markdown.trim().length < 80)) {
        page = await providers.readFallback(source.url).catch(() => undefined)
      }
      if (page && page.markdown.trim().length >= 80) {
        source.title = page.title || source.title
        source.fullText = page.markdown
        source.evidenceKind = 'page'
        source.publishedAt = page.publishedAt
        source.links = page.links
      } else source.evidenceKind = 'snippet'
    }))
  }
  onProgress?.('Lecture des sources…')
  await readSources(ranked.slice(0, 4))
  if (ranked.filter(source => source.fullText && pageMatchesQuery(query, source)).length < 2) await readSources(ranked.slice(4))
  const read = ranked.filter(source => visited.has(source.url))
  // Check the pages, not the number of links returned, before deciding whether to search again.
  const verified = read.filter(source => source.fullText && pageMatchesQuery(query, source))
  if (!directUrls.length && new Set(verified.map(source => source.domain)).size < 2) {
    onProgress?.('Vérification des résultats…')
    // If rewriting found nothing, give the original wording a chance on the primary index too.
    const recovery = [providers.fallback(query)]
    if (!providers.strictSearch && searchQuery !== query && ranked.length === 0) recovery.push(providers.search(query))
    const backup = (await Promise.allSettled(recovery)).flatMap(result => result.status === 'fulfilled' ? result.value : [])
    const extra = rankWebSources(query, backup.filter(inScope)).filter(source => !visited.has(source.url)).slice(0, 3)
    await readSources(extra)
    read.push(...extra)
  }
  const relevant = read.filter(source => pageMatchesQuery(query, source))
  const linked = selectPageLinks(query, relevant, visited).filter(inScope)
  if (linked.length) {
    onProgress?.('Lecture des pages liées…')
    await readSources(linked)
  }
  // A link label alone is never evidence. Keep only successfully read linked pages.
  const verifiedLinks = linked.filter((source) => source.fullText && pageMatchesQuery(query, source))
  const ordered = [...relevant.filter(source => source.fullText), ...verifiedLinks,
    ...(calendarScope ? [] : relevant.filter(source => !source.fullText))]
  const officialCalendars = calendarScope ? ordered.filter(calendarScope.isOfficialCalendar) : []
  const evidence = buildWebEvidence(calendarScope?.evidenceQuery ?? query, officialCalendars.length ? officialCalendars : ordered)
  return {
    query,
    sources: evidence.sources.map(({ fullText: _fullText, links: _links, ...source }) => ({ ...source, evidenceKind: source.evidenceKind ?? 'snippet' })),
    contextHeader: evidence.contextHeader,
    evidence: { instructions: evidence.instructions, blocks: evidence.blocks },
    // Evidence is already selected and budgeted. Do not inject the pages again as attachments.
    attachments: [],
  }
}
