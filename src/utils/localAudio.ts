/// <reference types="chrome"/>
// Utilitaires Audio, Dictée multilingue 100 % locaux :
// 1. Gestion automatique de la permission Microphone dans le Side Panel Chrome (popup d'autorisation auto-fermante)
// 2. Dictée manuelle (LocalMicRecorder) -> PCM 16 kHz
// 3. Capture audio d'onglet hybride 3-niveaux (tabCapture -> captureStream() DOM via <all_urls> -> getDisplayMedia)
// 4. Lecture des réponses à la demande via les voix du navigateur


const TARGET_SAMPLE_RATE = 16000

/**
 * Décode un Blob audio (WebM/Opus, Ogg, WAV) en un signal PCM mono Float32Array à 16 000 Hz
 * directement exploitable par le modèle Whisper multilingue dans `audioWorker.ts`.
 */
export async function decodeBlobTo16kHzPCM(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Aucun signal audio enregistré.')
  }

  const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    const targetLength = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
    const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE)
    const source = offlineCtx.createBufferSource()
    source.buffer = decoded
    source.connect(offlineCtx.destination)
    source.start(0)
    const rendered = await offlineCtx.startRendering()
    return new Float32Array(rendered.getChannelData(0))
  } finally {
    try {
      await audioCtx.close()
    } catch {
      /* ignore */
    }
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

/**
 * Dans Chrome Manifest V3, un Side Panel ne peut pas afficher la popup native d'autorisation du microphone
 * lors du tout premier appel (`DOMException: Permission dismissed`).
 * Cette fonction ouvre une petite fenêtre popup de l'extension (`index.html?requestMic=1`) qui affiche
 * la demande d'autorisation Chrome, puis se referme automatiquement dès que l'utilisateur clique sur « Autoriser ».
 */
async function requestMicPermissionViaExtensionPopup(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
    throw new Error("Veuillez autoriser l'accès au microphone dans les paramètres du navigateur.")
  }

  const popupUrl = chrome.runtime.getURL('index.html?requestMic=1')

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let popupWinId: number | undefined
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel('localai_mic_permission_channel')
    } catch {
      /* ignore */
    }

    const cleanup = () => {
      chrome.runtime?.onMessage?.removeListener(onRuntimeMsg)
      window.removeEventListener('storage', onStorageEvent)
      try {
        bc?.close()
      } catch {
        /* ignore */
      }
      clearTimeout(timeoutId)
    }

    const finishOk = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const finishErr = (msg: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(msg))
    }

    const onRuntimeMsg = (msg: any, _sender?: any, sendResponse?: (res?: any) => void) => {
      if (msg?.type === 'LOCALAI_MIC_PERMISSION_GRANTED') {
        sendResponse?.({ ok: true })
        finishOk()
      } else if (msg?.type === 'LOCALAI_MIC_PERMISSION_DENIED') {
        sendResponse?.({ ok: true })
        finishErr(msg.error || "L'autorisation du microphone a été refusée.")
      }
    }

    if (bc) {
      bc.onmessage = (ev) => {
        if (ev.data?.type === 'LOCALAI_MIC_PERMISSION_GRANTED') {
          finishOk()
        } else if (ev.data?.type === 'LOCALAI_MIC_PERMISSION_DENIED') {
          finishErr(ev.data.error || "L'autorisation du microphone a été refusée.")
        }
      }
    }

    const onStorageEvent = (e: StorageEvent) => {
      if (e.key === 'localai_mic_permission_status') {
        if (e.newValue?.startsWith('granted:')) {
          finishOk()
        } else if (e.newValue?.startsWith('denied:')) {
          finishErr("L'autorisation du microphone a été refusée.")
        }
      }
    }

    const timeoutId = setTimeout(() => {
      finishErr("Délai d'attente dépassé pour l'autorisation du microphone.")
    }, 45000)

    chrome.runtime?.onMessage?.addListener(onRuntimeMsg)
    window.addEventListener('storage', onStorageEvent)

    if (chrome.windows?.create) {
      chrome.windows.create(
        {
          url: popupUrl,
          type: 'popup',
          width: 440,
          height: 340,
          focused: true,
        },
        (win) => {
          popupWinId = win?.id
          if (chrome.runtime.lastError && chrome.tabs?.create) {
            chrome.tabs.create({ url: popupUrl, active: true })
          }
        },
      )
    } else if (chrome.tabs?.create) {
      chrome.tabs.create({ url: popupUrl, active: true })
    }

    // Surveille si l'utilisateur ferme la fenêtre sans répondre
    if (chrome.windows?.onRemoved) {
      const onWinRemoved = (closedId: number) => {
        if (popupWinId !== undefined && closedId === popupWinId) {
          chrome.windows.onRemoved.removeListener(onWinRemoved)
          setTimeout(() => {
            if (!settled) {
              finishErr("La fenêtre d'autorisation du microphone a été fermée.")
            }
          }, 400)
        }
      }
      chrome.windows.onRemoved.addListener(onWinRemoved)
    }
  })
}

async function acquireMicrophoneStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("L'accès au microphone n'est pas supporté dans ce contexte.")
  }

  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  }

  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch (err: any) {
    const errMsg = String(err?.message || err?.name || '')
    // Dans un Side Panel Chrome, le 1er appel renvoie "Permission dismissed" ou "NotAllowedError"
    if (
      errMsg.includes('Permission dismissed') ||
      errMsg.includes('NotAllowedError') ||
      errMsg.includes('Permission denied') ||
      err?.name === 'NotAllowedError'
    ) {
      await requestMicPermissionViaExtensionPopup()
      return await navigator.mediaDevices.getUserMedia(constraints)
    }
    throw err
  }
}

// Enregistrement manuel : le bouton micro démarre et termine la dictée.
export class LocalMicRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private audioSource: MediaStreamAudioSourceNode | null = null
  private session = 0

  waveformLevel(): number {
    if (!this.analyser) return 0
    const samples = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(samples)
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
    return Math.min(1, Math.sqrt(Math.max(0, rms - .002) * 5))
  }

  frequencyLevels(count = 24): number[] {
    if (!this.analyser || !this.audioContext) return Array(count).fill(0)
    const bins = new Uint8Array(this.analyser.frequencyBinCount)
    this.analyser.getByteFrequencyData(bins)
    const hzPerBin = this.audioContext.sampleRate / this.analyser.fftSize
    return Array.from({ length: count }, (_, i) => {
      const low = Math.max(1, Math.floor(80 * (5000 / 80) ** (i / count) / hzPerBin))
      const high = Math.min(bins.length, Math.max(low + 1, Math.ceil(80 * (5000 / 80) ** ((i + 1) / count) / hzPerBin)))
      let sum = 0
      for (let j = low; j < high; j++) sum += bins[j]
      return Math.min(1, Math.pow(sum / Math.max(1, high - low) / 255, 1.3))
    })
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  async start(): Promise<void> {
    if (this.isRecording) return
    const session = ++this.session
    const stream = await acquireMicrophoneStream()
    if (session !== this.session) { stream.getTracks().forEach(track => track.stop()); throw new DOMException('Cancelled', 'AbortError') }
    this.stream = stream
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''

      this.chunks = []
      this.recorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream)

      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data)
      }

      this.recorder.start(200)
    } catch (error) {
      this.cleanup()
      throw error
    }
    try {
      this.audioContext = new AudioContext()
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = .72
      this.audioSource = this.audioContext.createMediaStreamSource(stream)
      this.audioSource.connect(this.analyser)
      // No connection to the speakers: the meter never feeds the microphone back.
      await this.audioContext.resume()
    } catch { /* Recording remains available if the meter is unsupported. */ }

  }

  async stop(): Promise<Float32Array> {
    if (!this.recorder) {
      throw new Error("Aucun enregistrement micro n'est en cours.")
    }

    let blob: Blob
    try { blob = await new Promise<Blob>((resolve, reject) => {
      const rec = this.recorder!
      rec.onstop = () => {
        const b = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })
        resolve(b)
      }
      rec.onerror = () => reject(new Error("Erreur lors de l'enregistrement du microphone."))
      if (rec.state !== 'inactive') {
        rec.stop()
      } else {
        resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }))
      }
    }) } finally { this.cleanup() }
    return decodeBlobTo16kHzPCM(blob)
  }

  cancel(): void {
    this.session++
    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop()
      }
    } catch {
      /* ignore */
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.audioSource?.disconnect()
    this.audioSource = null
    this.analyser = null
    void this.audioContext?.close().catch(() => {})
    this.audioContext = null
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    this.recorder = null
    this.chunks = []
  }
}

/**
 * Contrôleur de capture audio de l'onglet actif à 3 niveaux :
 * - Niveau 1 : `chrome.tabCapture.capture` (avec reconnexion vers `audioCtx.destination`)
 * - Niveau 2 : Si `tabCapture` échoue avec `"Extension has not been invoked for the current page"`,
 *   bascule automatiquement sur la capture directe de l'élément `<video>` / `<audio>` dans l'onglet
 *   via `chrome.scripting.executeScript` (qui utilise `host_permissions: ["<all_urls>"]` sans nécessiter `activeTab` !)
 * - Niveau 3 : En ultime repli, propose `navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })`.
 */
export class TabAudioCaptureController {
  private stream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mode: 'stream' | 'in-page' | null = null
  private inPageTabId: number | null = null

  get isCapturing(): boolean {
    return this.mode === 'in-page' || this.recorder?.state === 'recording'
  }

  async start(): Promise<void> {
    if (this.isCapturing) return

    // Vérifie d'abord l'onglet actif pour donner un message explicite si c'est une page système chrome://
    let activeTab: chrome.tabs.Tab | undefined
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      activeTab = tab
      const url = tab?.url || ''
      if (
        !url ||
        url.startsWith('chrome://') ||
        url.startsWith('edge://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:')
      ) {
        throw new Error(
          "L'onglet actuel est une page interne du navigateur (ex: chrome://extensions). Ouvrez un onglet web contenant une vidéo ou un audio (YouTube, podcast, cours…) puis recliquez sur Audio.",
        )
      }
    }

    // ─── Niveau 1 : Tentative via `chrome.tabCapture.capture` ───
    if (typeof chrome !== 'undefined' && chrome.tabCapture?.capture) {
      try {
        const stream = await new Promise<MediaStream>((resolve, reject) => {
          chrome.tabCapture.capture({ audio: true, video: false }, (captured) => {
            const err = chrome.runtime.lastError
            if (err || !captured) {
              reject(new Error(err?.message || 'tabCapture non disponible'))
            } else {
              resolve(captured)
            }
          })
        })

        this.stream = stream
        this.audioCtx = new AudioContext()
        const streamSource = this.audioCtx.createMediaStreamSource(stream)
        streamSource.connect(this.audioCtx.destination)

        this.startLocalMediaRecorder(stream)
        this.mode = 'stream'
        return
      } catch (tabCaptureErr: any) {
        console.info('[LocalAI] Repli capture audio (tabCapture non invoqué):', tabCaptureErr?.message)
      }
    }

    // ─── Niveau 2 : Capture directe du `<video>` / `<audio>` dans la page via `chrome.scripting.executeScript` (<all_urls>) ───
    if (activeTab?.id && typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const w = window as any
            if (w.__localAiMediaRec && w.__localAiMediaRec.state === 'recording') {
              return { ok: true }
            }
            const mediaEls = Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[]
            const playingEl = mediaEls.find((el) => !el.paused && !el.ended) || mediaEls[0]
            if (!playingEl) {
              return { ok: false, reason: 'NO_MEDIA_ELEMENT' }
            }

            const captureFn =
              (playingEl as any).captureStream?.bind(playingEl) ||
              (playingEl as any).mozCaptureStream?.bind(playingEl)
            if (!captureFn) {
              return { ok: false, reason: 'NO_CAPTURE_STREAM' }
            }

            try {
              const fullStream: MediaStream = captureFn()
              const audioTracks = fullStream.getAudioTracks()
              if (audioTracks.length === 0) {
                return { ok: false, reason: 'NO_AUDIO_TRACK' }
              }
              const audioOnlyStream = new MediaStream(audioTracks)
              const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm'
              const rec = new MediaRecorder(audioOnlyStream, { mimeType: mime })
              w.__localAiChunks = []
              rec.ondataavailable = (ev: BlobEvent) => {
                if (ev.data && ev.data.size > 0) w.__localAiChunks.push(ev.data)
              }
              rec.start(400)
              w.__localAiMediaRec = rec
              return { ok: true }
            } catch (e: any) {
              return { ok: false, reason: String(e?.message || e) }
            }
          },
        })

        const outcome = res?.[0]?.result
        if (outcome?.ok) {
          this.mode = 'in-page'
          this.inPageTabId = activeTab.id
          return
        }
      } catch (scriptErr) {
        console.info('[LocalAI] Repli captureStream DOM échoué:', scriptErr)
      }
    }

    // ─── Niveau 3 : Partage d'onglet via `getDisplayMedia` (avec piste audio) ───
    if (navigator.mediaDevices?.getDisplayMedia) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          preferCurrentTab: true,
          systemAudio: 'include',
        } as any)

        const audioTracks = displayStream.getAudioTracks()
        // On coupe immédiatement la piste vidéo inutile pour ne garder que le son
        displayStream.getVideoTracks().forEach((vt) => vt.stop())

        if (audioTracks.length === 0) {
          displayStream.getTracks().forEach((t) => t.stop())
          throw new Error(
            "Aucune piste audio n'a été partagée. Cochez « Partager également l'audio de l'onglet » dans la fenêtre Chrome.",
          )
        }

        const audioOnlyStream = new MediaStream(audioTracks)
        this.stream = audioOnlyStream
        this.startLocalMediaRecorder(audioOnlyStream)
        this.mode = 'stream'
        return
      } catch (displayErr: any) {
        if (displayErr?.message?.includes('Partager également')) {
          throw displayErr
        }
      }
    }

    throw new Error(
      "Impossible de capturer l'audio sur cet onglet. Assurez-vous qu'une vidéo ou un flux audio est en cours de lecture sur la page.",
    )
  }

  private startLocalMediaRecorder(stream: MediaStream): void {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''

    this.chunks = []
    this.recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start(500)
  }

  async stop(): Promise<Float32Array> {
    if (this.mode === 'in-page' && this.inPageTabId !== null) {
      const tabId = this.inPageTabId
      this.mode = null
      this.inPageTabId = null

      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          const w = window as any
          const rec: MediaRecorder | undefined = w.__localAiMediaRec
          if (!rec) return null

          const dataUrl = await new Promise<string>((resolve) => {
            const finish = () => {
              const blob = new Blob(w.__localAiChunks || [], { type: rec.mimeType || 'audio/webm' })
              w.__localAiChunks = []
              w.__localAiMediaRec = null
              const reader = new FileReader()
              reader.onloadend = () => resolve(String(reader.result || ''))
              reader.readAsDataURL(blob)
            }
            if (rec.state !== 'inactive') {
              rec.onstop = finish
              rec.stop()
            } else {
              finish()
            }
          })
          return dataUrl
        },
      })

      const dataUrl = res?.[0]?.result
      if (!dataUrl) {
        throw new Error("Aucun enregistrement audio n'a pu être récupéré depuis l'onglet.")
      }
      const blob = await dataUrlToBlob(dataUrl)
      return decodeBlobTo16kHzPCM(blob)
    }

    if (!this.recorder) {
      throw new Error("Aucune capture audio d'onglet n'est en cours.")
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      const rec = this.recorder!
      rec.onstop = () => {
        resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }))
      }
      rec.onerror = () => reject(new Error("Erreur lors de la capture audio de l'onglet."))
      if (rec.state !== 'inactive') {
        rec.stop()
      } else {
        resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }))
      }
    })

    await this.cleanup()
    return decodeBlobTo16kHzPCM(blob)
  }

  async cancel(): Promise<void> {
    if (this.mode === 'in-page' && this.inPageTabId !== null) {
      const tabId = this.inPageTabId
      this.mode = null
      this.inPageTabId = null
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const w = window as any
            if (w.__localAiMediaRec && w.__localAiMediaRec.state !== 'inactive') {
              w.__localAiMediaRec.stop()
            }
            w.__localAiMediaRec = null
            w.__localAiChunks = []
          },
        })
      } catch {
        /* ignore */
      }
      return
    }

    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop()
      }
    } catch {
      /* ignore */
    }
    await this.cleanup()
  }

  private async cleanup(): Promise<void> {
    this.mode = null
    this.inPageTabId = null
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.audioCtx) {
      try {
        await this.audioCtx.close()
      } catch {
        /* ignore */
      }
      this.audioCtx = null
    }
    this.recorder = null
    this.chunks = []
  }
}

// ─── Synthèse Vocale Multilingue & Streaming Phrase par Phrase (Mode Vocal Temps Réel) ───

export function cleanMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+\]/g, '') // retire les références de sources [1], [2] à l'oral
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^[#>*\-+]+\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Détecte automatiquement la langue d'un texte (fr, en, es, de, it, pt, nl, ru, ja, zh, ko, ar)
 * pour sélectionner la voix correspondante dans toutes les langues.
 */
export function detectTextLanguage(text: string): string {
  const sample = text.slice(0, 500)
  if (!sample.trim()) return 'fr'

  // Scripts non-latins
  if (/[\u3040-\u30ff]/.test(sample)) return 'ja'
  if (/[\u4e00-\u9fff]/.test(sample)) return 'zh'
  if (/[\uac00-\ud7af]/.test(sample)) return 'ko'
  if (/[\u0600-\u06ff]/.test(sample)) return 'ar'
  if (/[\u0400-\u04ff]/.test(sample)) return 'ru'

  const lower = ` ${sample.toLowerCase()} `
  const scores: Record<string, number> = {
    fr: (
      lower.match(
        /\b(le|la|les|un|une|des|est|sont|dans|pour|avec|sur|pas|plus|vous|nous|je|tu|il|elle|on|c'est|qu'il|mais|comme|cette|bonjour|salut|merci|comment|pourquoi|quel|quelle|qui|que|quoi)\b/g,
      ) || []
    ).length,
    en: (
      lower.match(
        /\b(the|and|that|have|for|not|with|you|this|but|his|from|they|say|her|she|will|one|all|would|there|their|what|about|which|when|how|are|hey|hello|hi|can|could|should|please|thanks|thank|good|morning|help|explain|tell|why|where|who|is|it|my|your|we)\b/g,
      ) || []
    ).length,
    es: (
      lower.match(
        /\b(el|la|los|las|una|para|con|por|como|más|pero|sus|esta|entre|cuando|todo|son|dos|también|fue|había|hola|cómo|estás|qué|puedes|gracias|buenos|días)\b/g,
      ) || []
    ).length,
    de: (
      lower.match(
        /\b(der|die|das|und|in|den|von|zu|mit|sich|auf|für|nicht|ist|dem|als|auch|es|an|werden|aus|er|hat|dass|hallo|wie|geht|dir|ihnen|was|warum|bitte|danke|ich|du|wir|sie)\b/g,
      ) || []
    ).length,
    it: (
      lower.match(
        /\b(il|lo|la|gli|le|un|una|che|non|per|con|sono|come|più|questo|questa|anche|della|nella|hanno|ciao|stai|cosa|perché|grazie|buongiorno)\b/g,
      ) || []
    ).length,
    pt: (
      lower.match(
        /\b(os|as|um|uma|para|com|não|por|mais|como|mas|foi|ao|ele|das|tem|à|seu|sua|ou|ser|quando|muito|olá|oi|tudo|bem|você|obrigado)\b/g,
      ) || []
    ).length,
  }

  let bestLang = 'fr'
  let bestScore = scores.fr
  for (const [lang, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc
      bestLang = lang
    }
  }
  return bestLang
}

/**
 * Sélectionne la voix la plus naturelle et fluide disponible pour la langue détectée,
 * en privilégiant les voix locales (`localService === true`) et les voix neuronales/naturelles.
 */
function pickBestVoiceForLanguage(langPrefix: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const allVoices = window.speechSynthesis.getVoices()
  if (allVoices.length === 0) return null

  const normalizedPrefix = langPrefix.toLowerCase().slice(0, 2)
  const matchingLang = allVoices.filter((v) => v.lang.toLowerCase().startsWith(normalizedPrefix))
  // Let the browser resolve the requested language instead of forcing an unrelated accent.
  const pool = matchingLang

  // Score de qualité : privilégie localService + voix Natural / Neural / Premium / Enhanced
  const scored = pool.map((v) => {
    let score = 0
    if (v.localService) score += 20
    const name = v.name.toLowerCase()
    if (name.includes('natural') || name.includes('neural') || name.includes('premium') || name.includes('enhanced')) {
      score += 15
    }
    if (name.includes('denise') || name.includes('henri') || name.includes('hortense') || name.includes('paul') || name.includes('julie') || name.includes('thomas') || name.includes('amelie')) {
      score += 8
    }
    if (v.default) score += 4
    return { voice: v, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.voice ?? null
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export function speakMarkdownText(
  markdown: string,
  options?: { onStart?: () => void; onEnd?: () => void; onError?: (msg: string) => void },
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    options?.onError?.("La synthèse vocale n'est pas supportée par ce navigateur.")
    return
  }

  const text = cleanMarkdownForSpeech(markdown)
  if (!text) {
    options?.onEnd?.()
    return
  }

  stopSpeaking()

  const runSpeak = () => {
    const lang = detectTextLanguage(text)
    const voice = pickBestVoiceForLanguage(lang)

    const utterance = new SpeechSynthesisUtterance(text)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else {
      utterance.lang = lang
    }
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.onstart = () => options?.onStart?.()
    utterance.onend = () => options?.onEnd?.()
    utterance.onerror = () => options?.onEnd?.()
    window.speechSynthesis.speak(utterance)
  }

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null
      runSpeak()
    }
  } else {
    runSpeak()
  }
}

