/// <reference types="chrome"/>
import { canonicalWebUrl } from './webEvidence'
// Outils d'inspection locale de l'onglet actif Chrome :
// 1. Extraction structurée en Markdown de la page web active (ou de la sélection)
// 2. Capture d'écran instantanée de l'onglet visible (Vision)
// 3. Extraction des pistes de sous-titres / transcriptions et métadonnées audio/vidéo

export interface ExtractedPageContent {
  title: string
  url: string
  selectedText: string
  markdown: string
  wordCount: number
  charCount: number
}

export interface CapturedTabScreenshot {
  dataUrl: string
  title: string
  url: string
}

export interface ExtractedTabAudioInfo {
  title: string
  url: string
  hasMediaElement: boolean
  hasTranscript: boolean
  transcriptSource: string
  transcriptText: string
  mediaSummary: string
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return true
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  )
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    throw new Error("L'API chrome.tabs n'est disponible que dans l'extension Chrome.")
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id) {
    throw new Error('Aucun onglet actif détecté.')
  }
  return tab
}

/**
 * Extrait le contenu principal de la page active (ou le texte sélectionné en priorité)
 * en supprimant le bruit (scripts, nav, footer, bannières cookies/pubs) et en conservant
 * la structure Markdown (titres, listes, blocs de code, tableaux).
 */
export async function extractActivePageContent(expectedUrl?: string): Promise<ExtractedPageContent> {
  const tab = await getActiveTab()
  if (isRestrictedUrl(tab.url)) {
    throw new Error(
      "Impossible de lire cette page système du navigateur (chrome:// ou Chrome Web Store). Ouvrez une page web classique.",
    )
  }
  if (expectedUrl && canonicalWebUrl(tab.url!) !== expectedUrl) throw new Error('Cette page n’est pas l’onglet actif.')

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    args: [expectedUrl ? tab.url ?? null : null],
    func: (expectedLocation) => {
      if (expectedLocation && location.href !== expectedLocation) return null
      const selectedText = (window.getSelection()?.toString() ?? '').trim()

      // Sélectionne le conteneur sémantique principal s'il existe
      const mainCandidate =
        document.querySelector('article, [role="main"], main, .main-content, #main-content, #content, .post-content, .article-body') ??
        document.body

      const noiseSelector =
        'script, style, noscript, svg, canvas, iframe, nav, footer, aside, ' +
        '[role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], ' +
        '[aria-hidden="true"], .cookie, #cookie, [id*="cookie" i], [class*="cookie" i], ' +
        '[class*="consent" i], [id*="consent" i], .ads, .ad, .advertisement, ' +
        '.sidebar, .popup, .modal, .newsletter, .share, .social'

      // Convertit récursivement le DOM en Markdown structuré sans cloner le DOM (évite tout déclenchement CSP sur les attributs on* inline)
      function nodeToMd(node: Node): string {
        if (node.nodeType === Node.TEXT_NODE) {
          return (node.textContent ?? '').replace(/[ \t]+/g, ' ')
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return ''

        const el = node as HTMLElement
        try {
          if (el.matches(noiseSelector)) return ''
        } catch {
          /* ignore */
        }

        const tag = el.tagName.toLowerCase()

        if (tag === 'br') return '\n'
        if (tag === 'hr') return '\n---\n'

        if (tag === 'pre') {
          const codeText = (el.textContent ?? '').trim()
          return codeText ? `\n\`\`\`\n${codeText}\n\`\`\`\n` : ''
        }

        if (tag === 'code' && el.parentElement?.tagName.toLowerCase() !== 'pre') {
          const inline = (el.textContent ?? '').trim()
          return inline ? `\`${inline}\`` : ''
        }

        if (tag === 'table') {
          const rows = Array.from(el.querySelectorAll('tr'))
          if (rows.length === 0) return ''
          const mdRows: string[] = []
          rows.slice(0, 40).forEach((tr, rowIdx) => {
            const cells = Array.from(tr.querySelectorAll('th, td')).map((c) =>
              (c.textContent ?? '').replace(/\s+/g, ' ').trim(),
            )
            if (cells.some(Boolean)) {
              mdRows.push(`| ${cells.join(' | ')} |`)
              if (rowIdx === 0) {
                mdRows.push(`| ${cells.map(() => '---').join(' | ')} |`)
              }
            }
          })
          return mdRows.length > 0 ? `\n${mdRows.join('\n')}\n` : ''
        }

        const childrenText = Array.from(el.childNodes).map(nodeToMd).join('')
        const trimmed = childrenText.trim()
        if (!trimmed) return ''

        if (tag === 'h1') return `\n# ${trimmed}\n`
        if (tag === 'h2') return `\n## ${trimmed}\n`
        if (tag === 'h3') return `\n### ${trimmed}\n`
        if (tag === 'h4' || tag === 'h5' || tag === 'h6') return `\n#### ${trimmed}\n`
        if (tag === 'li') return `\n- ${trimmed}`
        if (tag === 'blockquote') return `\n> ${trimmed.replace(/\n/g, '\n> ')}\n`
        if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' || tag === 'ul' || tag === 'ol') {
          return `\n${trimmed}\n`
        }
        return childrenText
      }

      const rawMd = nodeToMd(mainCandidate)
      const cleanedMd = rawMd
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      const finalMd = (cleanedMd || (document.body?.innerText ?? '').trim()).slice(0, 32000)
      const words = finalMd.split(/\s+/).filter(Boolean).length

      return {
        title: document.title || location.hostname,
        url: location.href,
        selectedText: selectedText.slice(0, 16000),
        markdown: finalMd,
        wordCount: words,
        charCount: finalMd.length,
      }
    },
  })

  const payload = results?.[0]?.result
  if (!payload || (!payload.markdown && !payload.selectedText)) {
    throw new Error("Aucun contenu textuel exploitable n'a pu être extrait de cet onglet.")
  }
  return payload
}

/**
 * Capture une image PNG de la zone visible de l'onglet actif.
 */
export async function captureActiveTabScreenshot(): Promise<CapturedTabScreenshot> {
  const tab = await getActiveTab()
  if (isRestrictedUrl(tab.url)) {
    throw new Error(
      "Impossible de capturer une page système du navigateur (chrome:// ou Chrome Web Store). Ouvrez une page web classique.",
    )
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (url) => {
      const err = chrome.runtime.lastError
      if (err || !url) {
        reject(new Error(err?.message || "Échec de la capture d'écran de l'onglet."))
      } else {
        resolve(url)
      }
    })
  })

  return {
    dataUrl,
    title: tab.title || 'Capture onglet',
    url: tab.url || '',
  }
}

/**
 * Inspecte l'onglet actif pour récupérer instantanément les pistes de sous-titres (<track>),
 * les panneaux de transcription (ex: YouTube) et les métadonnées des éléments <video>/<audio>.
 */
export async function extractActiveTabAudioTranscript(): Promise<ExtractedTabAudioInfo> {
  const tab = await getActiveTab()
  if (isRestrictedUrl(tab.url)) {
    throw new Error(
      "Impossible d'analyser l'audio d'une page système (chrome://). Ouvrez une page contenant un média audio ou vidéo.",
    )
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async () => {
      const title = document.title || location.hostname
      const url = location.href
      const mediaElements = Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[]
      const hasMediaElement = mediaElements.length > 0

      const metaLines: string[] = [`Page : ${title}`, `URL : ${url}`]
      const metaDesc =
        document.querySelector('meta[name="description"]')?.getAttribute('content') ||
        document.querySelector('meta[property="og:description"]')?.getAttribute('content')
      if (metaDesc) metaLines.push(`Description : ${metaDesc.slice(0, 400)}`)

      mediaElements.forEach((m, i) => {
        const dur = Number.isFinite(m.duration) && m.duration > 0 ? `${Math.round(m.duration)}s` : 'durée inconnue'
        const pos = Number.isFinite(m.currentTime) ? `${Math.round(m.currentTime)}s` : '0s'
        metaLines.push(`Média #${i + 1} (${m.tagName.toLowerCase()}) : position ${pos} / ${dur}`)
      })

      const transcriptParts: string[] = []
      let transcriptSource = ''

      // 1. Pistes HTML5 <track> déjà chargées (TextTrack cues)
      for (const m of mediaElements) {
        const tracks = Array.from(m.textTracks ?? [])
        for (const t of tracks) {
          if (t.cues && t.cues.length > 0) {
            const lines: string[] = []
            for (let i = 0; i < t.cues.length; i++) {
              const cue = t.cues[i] as VTTCue
              if (cue?.text) lines.push(cue.text.replace(/<[^>]+>/g, '').trim())
            }
            if (lines.length > 0) {
              transcriptParts.push(lines.join(' '))
              transcriptSource = `Sous-titres HTML5 (${t.label || t.language || t.kind})`
              break
            }
          }
        }
      }

      // 2. Éléments <track src="..."> téléchargeables en VTT/SRT
      if (transcriptParts.length === 0) {
        const trackTags = Array.from(document.querySelectorAll('track[src]')) as HTMLTrackElement[]
        for (const tr of trackTags) {
          try {
            if (!tr.src) continue
            const resp = await fetch(tr.src)
            if (resp.ok) {
              const rawVtt = await resp.text()
              const cleaned = rawVtt
                .replace(/^WEBVTT[^\n]*\n/i, '')
                .replace(/\d{2}:\d{2}[:.]\d{2,3}\s*-->\s*\d{2}:\d{2}[:.]\d{2,3}[^\n]*/g, '')
                .replace(/^\d+\s*$/gm, '')
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim()
              if (cleaned.length > 40) {
                transcriptParts.push(cleaned)
                transcriptSource = `Piste de sous-titres (${tr.label || tr.srclang || 'VTT'})`
                break
              }
            }
          } catch {
            /* ignore CORS */
          }
        }
      }

      // 3. Panneau de transcription YouTube ou chapitres dans le DOM
      if (transcriptParts.length === 0) {
        const ytSegments = Array.from(
          document.querySelectorAll(
            'ytd-transcript-segment-renderer .segment-text, ytd-transcript-segment-renderer yt-formatted-string, [class*="transcript" i] [class*="cue" i]',
          ),
        )
        if (ytSegments.length > 0) {
          const text = ytSegments
            .map((el) => (el.textContent ?? '').trim())
            .filter(Boolean)
            .join(' ')
          if (text.length > 40) {
            transcriptParts.push(text)
            transcriptSource = 'Transcription de la page'
          }
        }
      }

      const transcriptText = transcriptParts.join('\n\n').slice(0, 28000).trim()

      return {
        title,
        url,
        hasMediaElement,
        hasTranscript: transcriptText.length > 40,
        transcriptSource,
        transcriptText,
        mediaSummary: metaLines.join('\n'),
      }
    },
  })

  const info = results?.[0]?.result
  if (!info) {
    throw new Error("Impossible d'inspecter les médias de l'onglet actif.")
  }
  return info
}
