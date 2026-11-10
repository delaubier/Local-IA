import { useState, useEffect, useRef } from 'react'
import {
  Download,
  CheckCircle2,
  Moon,
  Sun,
  Copy,
  ArrowUp,
  Loader2,
  Menu,
  Plus,
  X,
  RotateCcw,
  AlertTriangle,
  Volume2,
  Mic,
  Square,
  FileText,
  Globe,
  Camera,
  Headphones,
  Paperclip,
  Sparkles,
  Brain,
  Zap,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  DEFAULT_MODEL_ID,
  VISION_MODEL_ID,
  LFM_MODELS,
  modelForRequest,
  getModelSpec,
  type ChatTurn,
  type WorkerRequest,
  type WorkerResponse,
  type GenerationMetrics,
} from './llm-protocol'
import {
  ACCEPTED_FILE_EXTENSIONS,
  isCodeFileName,
  extractCodeOutline,
  buildStructuredPdfDocument,
  buildSmartAttachmentContext,
  type SmartAttachment,
} from './utils/smartContext'
import {
  extractActivePageContent,
  captureActiveTabScreenshot,
  extractActiveTabAudioTranscript,
} from './utils/tabTools'
import {
  LocalMicRecorder,
  TabAudioCaptureController,
  speakMarkdownText,
  stopSpeaking,
} from './utils/localAudio'
import {
  performWebResearch,
  detectAutoToolIntent,
  detectModelToolCall,
  extractModelWebSearchQuery,
  buildContextualWebQuery,
  compactWebQuery,
  isGeneralDefinition,
  extractUrlsFromText,
  shouldTriggerWebSearch,
  type AutoToolType,
  type WebSearchSource,
  type WebSearchOutcome,
} from './utils/webSearch'
import { originalRequest } from './utils/replyLanguage'
import { formatCitations, getCitedSources } from './utils/citations'
import { GenerationRun } from './utils/generationRun'
import { isAssistantIdentityQuestion, continuesVisualContext, selectRequestHistory, countRequestedWord } from './utils/conversationContext'
import type { AudioMetrics, AudioWorkerRequest, AudioWorkerResponse } from './audioWorker'
import { ModelSetupDialog } from './components/ModelSetupDialog'
import { SettingsDialog, type SettingsAction } from './components/SettingsDialog'
import { ConversationSidebar } from './components/ConversationSidebar'
import { ResponseStats } from './components/ResponseStats'
import { DictationVisualizer } from './components/DictationVisualizer'
import { normalizeModelSettings, settingsForModel, readModelSettings, readImportedModels, type ModelSettings, type ImportedModel } from './utils/modelSettings'
import { tr, useInterfaceLanguage, interfaceLocale } from './utils/i18n'
import { audioModelId as resolveAudioModelId, DEFAULT_AUDIO_MODEL, importedAudioDtype, readAudioModel, readDictationBackend, readDictationLanguage, readImportedAudioModels, type AudioDevice, type DictationBackend, type DictationLanguage } from './utils/audioModels'
import { importAudioModel } from './utils/audioModelImport'
import { clearModelFiles } from './utils/modelCache'
import { createResearchProviders, DEFAULT_WEB_SETTINGS, readWebSettings, WEB_SETTINGS_KEY } from './utils/webProviders'
import { exactPercentage } from './utils/exactCalculation'
import { electionCalendarLookup, electionCountryFromReply, isPresidentialLookup, presidentialQuestionLanguage, previousElectionCountry, scopeElectionQuestion } from './utils/electionScope'
import { recommendTextModel } from './utils/modelRecommendation'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type ChatMessageContent = string | { type: string; text?: string; image_url?: { url: string } }[]

export type Attachment = SmartAttachment

interface ChatMessage {
  metrics?: GenerationMetrics
  thinking?: boolean
  failed?: boolean
  sentAt?: number
  researchSteps?: string[]
  electionScope?: 'fr' | 'en'
  originalUserText?: string
  role: string
  content: ChatMessageContent
  attachedFiles?: Attachment[]
  ragBadge?: string
  webSources?: WebSearchSource[]
  autoToolLabel?: string
}

export interface ChatSession {
  pinned?: boolean
  id: string
  title: string
  messages: ChatMessage[]
  timestamp: number
  modelId: string
}

const textOf = (content: ChatMessageContent): string =>
  Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n') : content

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim()

const formatDuration = (sec: number) => {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function MessageTime({ value }: { value?: number }) {
  if (!value || !Number.isFinite(value)) return null
  const date = new Date(value)
  return <time dateTime={date.toISOString()} title={date.toLocaleString(interfaceLocale())}>{date.toLocaleTimeString(interfaceLocale(), { hour: '2-digit', minute: '2-digit' })}</time>
}


const CodeBlock = ({ inline, className, children, ...props }: any) => {
  const [copied, setCopied] = useState(false)
  const match = /language-(\w+)/.exec(className || '')
  const language = match ? match[1] : 'text'
  const codeString = String(children).replace(/\n$/, '')

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([codeString], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    let ext = 'txt'
    if (language === 'python') ext = 'py'
    else if (language === 'javascript' || language === 'js') ext = 'js'
    else if (language === 'typescript' || language === 'ts') ext = 'ts'
    else if (language === 'html') ext = 'html'
    else if (language === 'css') ext = 'css'
    else if (language === 'json') ext = 'json'
    else ext = language
    a.download = `code.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (inline || !match) {
    return (
      <code
        {...props}
        className={`${className} bg-slate-200/70 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded-md text-[0.85em] font-mono`}
      >
        {children}
      </code>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden my-3 border border-slate-800 bg-[#161821] shadow-md">
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#1e202b] border-b border-slate-800">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-sans">{language}</span>
        <div className="flex items-center gap-1.5 text-slate-400">
          <button
            onClick={handleDownload}
            title={tr("Télécharger")}
            className="cursor-pointer hover:text-white transition-colors p-1 hover:bg-slate-700/60 rounded-lg"
          >
            <Download size={13} strokeWidth={2.2} />
          </button>
          <button
            onClick={handleCopy}
            title="Copier le code"
            className="cursor-pointer hover:text-white transition-colors p-1 hover:bg-slate-700/60 rounded-lg"
          >
            {copied ? (
              <CheckCircle2 size={13} className="text-emerald-400" strokeWidth={2.2} />
            ) : (
              <Copy size={13} strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto text-[12.5px]">
        <SyntaxHighlighter
          {...props}
          style={vscDarkPlus}
          language={language}
          PreTag="div"
          customStyle={{ margin: 0, background: 'transparent', padding: '1rem', fontSize: '12.5px', lineHeight: '1.55' }}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

/**
 * Fenêtre popup dédiée à l'autorisation du microphone (ouverte automatiquement par `LocalMicRecorder`
 * la toute première fois car le Side Panel Chrome ne peut pas afficher la popup native `getUserMedia`).
 */
function MicPermissionPopupView() {
  const [status, setStatus] = useState<'prompting' | 'granted' | 'denied'>('prompting')
  const [errDetail, setErrDetail] = useState<string>('')

  const notifyPermissionResult = (payload: Record<string, any>) => {
    try {
      const maybePromise = chrome.runtime?.sendMessage?.(payload)
      if (maybePromise && typeof (maybePromise as Promise<any>).catch === 'function') {
        ;(maybePromise as Promise<any>).catch(() => {
          /* ignore : le Side Panel lira le résultat via localStorage */
        })
      }
    } catch {
      /* ignore */
    }
    try {
      const bc = new BroadcastChannel('localai_mic_permission_channel')
      bc.postMessage(payload)
      bc.close()
    } catch {
      /* ignore */
    }
  }

  const requestMicNow = async () => {
    setStatus('prompting')
    setErrDetail('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach((t) => t.stop())
      setStatus('granted')
      try {
        localStorage.setItem('localai_mic_permission_status', `granted:${Date.now()}`)
      } catch {
        /* ignore */
      }
      notifyPermissionResult({ type: 'LOCALAI_MIC_PERMISSION_GRANTED' })
      setTimeout(() => {
        window.close()
      }, 250)
    } catch (e: any) {
      setStatus('denied')
      const msg = String(e?.message || e || 'Refusé')
      setErrDetail(msg)
      try {
        localStorage.setItem('localai_mic_permission_status', `denied:${Date.now()}`)
      } catch {
        /* ignore */
      }
      notifyPermissionResult({ type: 'LOCALAI_MIC_PERMISSION_DENIED', error: msg })
    }
  }

  useEffect(() => {
    void requestMicNow()
  }, [])

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0b0f19] text-slate-100 p-6 text-center font-sans">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 mb-4">
        <Mic size={26} />
      </div>
      <h1 className="text-base font-bold mb-1.5">{tr('Activation du microphone Locaya')}</h1>
      {status === 'prompting' && (
        <p className="text-xs text-slate-300 max-w-xs leading-relaxed mb-4">
          {tr('Cliquez sur « Autoriser » dans la notification de Chrome. Cette fenêtre se fermera automatiquement.')}
        </p>
      )}
      {status === 'granted' && (
        <p className="text-xs text-emerald-400 font-semibold">
          {tr('Microphone autorisé ! Retour automatique à Locaya…')}
        </p>
      )}
      {status === 'denied' && (
        <div className="space-y-3">
          <p className="text-xs text-amber-300 max-w-xs leading-relaxed">
            {tr('Le microphone n’est pas encore autorisé. Réessayez puis cliquez sur « Autoriser ».')} ({errDetail})
          </p>
          <button
            onClick={requestMicNow}
            className="cursor-pointer px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md"
          >
            {tr("Réessayer l'autorisation")}
          </button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const isMicPermissionPopup =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('requestMic') === '1'
  if (isMicPermissionPopup) {
    return <MicPermissionPopupView />
  }
  return <ChatApp />
}

function ChatApp() {
  const [dark, setDark] = useState<boolean>(() => {
    const savedTheme = localStorage.getItem('localaiTheme')
    return savedTheme ? savedTheme === 'dark' : true
  })
  const webSearchEnabled = true
  const { preference: languagePreference, setLanguage, resetLanguage } = useInterfaceLanguage()
  const [showSettings, setShowSettings] = useState(false)
  const [webSettings, setWebSettings] = useState(readWebSettings)
  const [importedModels, setImportedModels] = useState<ImportedModel[]>(readImportedModels)
  const [modelSettings, setModelSettings] = useState<Record<string, ModelSettings>>(readModelSettings)
  const modelSettingsRef = useRef(modelSettings)
  modelSettingsRef.current = modelSettings
  const [textModelId, setTextModelId] = useState(() => {
    const saved = localStorage.getItem('localaiTextModel')
    return saved && (readImportedModels().some(model => model.id === saved) || LFM_MODELS.some(model => model.id === saved && model.ggufFile)) ? saved : DEFAULT_MODEL_ID
  })
  const textModelIdRef = useRef(textModelId)
  textModelIdRef.current = textModelId
  const hadSavedModelChoiceRef = useRef(Boolean(localStorage.getItem('localaiTextModel')))
  const [recommendedModelId, setRecommendedModelId] = useState(DEFAULT_MODEL_ID)
  const [searchingWeb, setSearchingWeb] = useState<boolean>(false)
  const [webResearch, setWebResearch] = useState<{ query: string; steps: string[]; sentAt: number }>({ query: '', steps: [], sentAt: 0 })
  const pendingWebFallbackRef = useRef<{
    query: string
    baseMessages: ChatMessage[]
    attachments: Attachment[]
    onlyWebFallback?: boolean
    requireCustomQuery?: boolean
  } | null>(null)
  const lastRawStreamedTextRef = useRef<string>('')
  const generationRunRef = useRef(new GenerationRun())
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null)
  const [copiedMessageIdx, setCopiedMessageIdx] = useState<number | null>(null)
  useEffect(() => {
    if (copiedMessageIdx === null) return
    const timer = setTimeout(() => setCopiedMessageIdx(null), 2000)
    return () => clearTimeout(timer)
  }, [copiedMessageIdx])

  const [selectedModelId, setSelectedModelId] = useState<string>(textModelId)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useState(() => localStorage.getItem('localaiThinkingEnabled') === 'true')
  useEffect(() => { localStorage.setItem('localaiThinkingEnabled', String(thinkingEnabled)) }, [thinkingEnabled])
  const toolsMenuRef = useRef<HTMLDivElement>(null)

  // ─── État du Web Worker LLM ───
  const workerRef = useRef<Worker | null>(null)
  const [workerEpoch, setWorkerEpoch] = useState(0)
  const [cachedMap, setCachedMap] = useState<Record<string, boolean>>({})
  const catalogModels = LFM_MODELS.filter(model => model.ggufFile && (!model.legacy || cachedMap[model.id] || model.id === textModelId))
  const modelCatalog = [...catalogModels.map(model => ({ id: model.id, name: model.name, bytes: model.ggufBytes ?? 0 })), ...importedModels]
  const [, setLoadedModelId] = useState<string | null>(null)
  const loadedModelIdRef = useRef<string | null>(null)
  const [loadingModelId, setLoadedModelIdLoading] = useState<string | null>(null)
  const [webgpuAvailable, setWebgpuAvailable] = useState(true)
  const [cacheChecked, setCacheChecked] = useState(false)
  const [startupReady, setStartupReady] = useState(false)
  const startupReadyRef = useRef(false)
  const cachedModelsRef = useRef<Record<string, boolean>>({})
  const startupCheckRef = useRef(false)
  useEffect(() => {
    if (!cacheChecked) return
    const state = { cancelled: false }
    void (async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<object | null> } }).gpu
      const adapter = await gpu?.requestAdapter().catch(() => null)
      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      const suggested = recommendTextModel(memory)
      if (state.cancelled) return
      if (!adapter) { setWebgpuAvailable(false); startupReadyRef.current = false; setStartupReady(false) }
      setRecommendedModelId(suggested)

    })()
    return () => { state.cancelled = true }
  }, [cacheChecked])
  const [requestedModelId, setRequestedModelId] = useState<string | null>(null)
  const pendingModelActionRef = useRef<(() => void) | null>(null)
  const [loadPhase, setLoadPhase] = useState<'download' | 'import' | 'warmup'>('download')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusBanner, setStatusBanner] = useState<string | null>(null)

  // ─── État du Web Worker Audio (Whisper multilingue 100 % local) ───
  const audioWorkerRef = useRef<Worker | null>(null)
  const [audioModelId, setAudioModelId] = useState<string>(readAudioModel)
  const [dictationBackend, setDictationBackend] = useState(readDictationBackend)
  const dictationBackendRef = useRef(dictationBackend)
  const [audioDevice, setAudioDevice] = useState<AudioDevice | null>(null)
  const [audioModelInstalled, setAudioModelInstalled] = useState(false)
  const [dictationLanguage, setDictationLanguage] = useState(readDictationLanguage)
  const [micDeviceId, setMicDeviceId] = useState(() => localStorage.getItem('localaiMicrophone') ?? '')
  const [audioMetrics, setAudioMetrics] = useState<AudioMetrics | null>(null)
  const changeDictationLanguage = (value: DictationLanguage) => {
    localStorage.setItem('localaiDictationLanguage', value)
    setDictationLanguage(value)
  }
  const changeMicDevice = (id: string) => {
    localStorage.setItem('localaiMicrophone', id)
    setMicDeviceId(id)
  }
  const [importedAudioModels, setImportedAudioModels] = useState(readImportedAudioModels)
  const audioModelRef = useRef(audioModelId)
  const audioJobRef = useRef(0)
  const micRecorderRef = useRef<LocalMicRecorder>(new LocalMicRecorder())
  const pendingDictationRef = useRef(false)
  const startDictationRef = useRef<() => Promise<void>>(async () => {})
  const micStartingRef = useRef(false)
  const tabAudioControllerRef = useRef<TabAudioCaptureController>(new TabAudioCaptureController())
  const [isRecordingMic, setIsRecordingMic] = useState(false)
  const [isCapturingTabAudio, setIsCapturingTabAudio] = useState(false)
  const [tabAudioSeconds, setTabAudioSeconds] = useState(0)
  const [asrBusyText, setAsrBusyText] = useState<string | null>(null)
  const [whisperCached, setWhisperCached] = useState<boolean | null>(null)
  const [whisperReady, setWhisperReady] = useState(false)
  const whisperReadyRef = useRef(false)
  const [showWhisperSetup, setShowWhisperSetup] = useState(false)
  const [whisperLoading, setWhisperLoading] = useState(false)
  const [whisperProgress, setWhisperProgress] = useState(0)
  const [whisperError, setWhisperError] = useState<string | null>(null)
  const audioSummaryRef = useRef<(prompt: string, title: string) => void>(() => {})
  const tabAudioPageTitleRef = useRef<string>('Onglet actif')

  // ─── Conversation & Fichiers ───
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const historyWriteEpochRef = useRef(0)
  const [input, setInput] = useState('')
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = composerInputRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`
  }, [input])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pdfExtractionStatus, setPdfExtractionStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [generating, setGenerating] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('chatHistory')
    return saved ? JSON.parse(saved) : []
  })
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)

  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const loading = loadingModelId !== null
  const setupId = loadingModelId || requestedModelId || textModelId
  const importedSetup = importedModels.find(model => model.id === setupId)
  const setupSpec = importedSetup ? { ...getModelSpec(DEFAULT_MODEL_ID), id: importedSetup.id, name: importedSetup.name, sizeLabel: `${(importedSetup.bytes / 1e9).toFixed(2)} Go` } : getModelSpec(setupId)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, searchingWeb, webResearch.steps.length])

  useEffect(() => {
    localStorage.setItem('localaiTheme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  useEffect(() => {
    localStorage.setItem('autoWebSearch', String(webSearchEnabled))
  }, [webSearchEnabled])
  useEffect(() => {
    localStorage.setItem('selectedLfmModel', selectedModelId)
  }, [selectedModelId])
  useEffect(() => { if (hadSavedModelChoiceRef.current) localStorage.setItem('localaiTextModel', textModelId) }, [textModelId])
  useEffect(() => { localStorage.setItem('localaiModelSettings', JSON.stringify(modelSettings)) }, [modelSettings])
  useEffect(() => { localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(webSettings)) }, [webSettings])
  useEffect(() => { localStorage.setItem('localaiImportedModels', JSON.stringify(importedModels)) }, [importedModels])
  useEffect(() => { localStorage.setItem('localaiAudioModel', audioModelId) }, [audioModelId])

  // Fermer le panneau de réglages au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setShowToolsMenu(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  // Chronomètre pour la capture audio d'onglet en direct
  useEffect(() => {
    if (!isCapturingTabAudio) {
      setTabAudioSeconds(0)
      return
    }
    const timer = setInterval(() => {
      setTabAudioSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [isCapturingTabAudio])

  const executeAutoToolFallbackRef = useRef<
    (
      tool: NonNullable<AutoToolType>,
      rawQuery: string,
      baseMessagesOverride?: ChatMessage[],
      baseAttachmentsOverride?: Attachment[],
      overrideSearchQuery?: string,
    ) => Promise<void>
  >(async () => {})

  const postToWorker = (msg: WorkerRequest) => workerRef.current?.postMessage(msg)

  // ─── Initialisation du Web Worker LLM ───
  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (workerRef.current !== worker) return
      const msg = event.data
      if (msg.requestId !== undefined && !generationRunRef.current.accepts(msg.requestId)) return
      switch (msg.type) {
        case 'web-evidence-limit':
          setMessages(previous => previous.map((message, index) => index === previous.length - 2 && message.webSources
            ? { ...message, webSources: message.webSources.slice(0, msg.sourceCount) }
            : message))
          break
        case 'cache-status':
          setWebgpuAvailable(msg.webgpu)
          setCachedMap(msg.cachedMap)
          setLoadedModelId(msg.loadedModelId)
          loadedModelIdRef.current = msg.loadedModelId
          cachedModelsRef.current = msg.cachedMap
          setCacheChecked(true)
          if (!startupCheckRef.current) {
            startupCheckRef.current = true
            if (msg.cachedMap[textModelIdRef.current] && msg.webgpu) {
              setRequestedModelId(null)
              startupReadyRef.current = true
              setStartupReady(true)
            }
          }
          break
        case 'load-progress':
          setLoadedModelIdLoading(msg.modelId)
          setLoadPhase(msg.phase)
          setProgress(msg.progress)
          break
        case 'ready':
          setLoadedModelIdLoading(null)
          setLoadedModelId(msg.modelId)
          loadedModelIdRef.current = msg.modelId
          setCachedMap((prev) => ({ ...prev, [msg.modelId]: true }))
          setErrorMsg(null)
          cachedModelsRef.current[msg.modelId] = true
          if (msg.modelId !== VISION_MODEL_ID) {
            startupReadyRef.current = true
            setStartupReady(true)
          }
          setRequestedModelId(null)
          {
            const action = pendingModelActionRef.current
            pendingModelActionRef.current = null
            action?.()
          }
          break
        case 'prefill':
          break
        case 'text': {
          lastRawStreamedTextRef.current = msg.text
          const toolPolicy = pendingWebFallbackRef.current
          const requestedTool = detectModelToolCall(stripThink(msg.text), false)
          const allowedTool = toolPolicy && requestedTool &&
            (!toolPolicy.onlyWebFallback || requestedTool === 'web') &&
            (!toolPolicy.requireCustomQuery || !!extractModelWebSearchQuery(stripThink(msg.text)))
          if (allowedTool && generationRunRef.current.requestStop()) {
            worker.postMessage({ type: 'interrupt', requestId: generationRunRef.current.id } satisfies WorkerRequest)
          }
          if (allowedTool) break // Do not display a draft while handing off to a tool.
          const cleanedDisplay = msg.text
            .replace(/\[(?:WEB_SEARCH|TOOL:PAGE|TOOL:SCREEN|TOOL:AUDIO|TOOL:WEB)(?:\s*:[^\]]*)?\]/gi, '')
            .trim()
          setMessages((prev) => {
            const n = [...prev]
            n[n.length - 1] = {
              ...n[n.length - 1],
              content: cleanedDisplay,
              sentAt: n[n.length - 1]?.sentAt ?? Date.now(),
            }
            return n
          })
          break
        }
        case 'done': {
          generationRunRef.current.finish()
          setGenerating(false)

          const rawStreamed = msg.text ?? lastRawStreamedTextRef.current
          lastRawStreamedTextRef.current = ''
          const latestMsgs = messagesRef.current
          const lastAssistant = latestMsgs[latestMsgs.length - 1]
          const lastAssistantText =
            rawStreamed || (lastAssistant?.role === 'assistant' ? textOf(lastAssistant.content) : '')
          setMessages((previous) => previous.map((message, index) => index === previous.length - 1 && message.role === 'assistant' ? {
            ...message,
            ...(msg.text !== undefined ? { content: msg.text.replace(/\[(?:WEB_SEARCH|TOOL:PAGE|TOOL:SCREEN|TOOL:AUDIO|TOOL:WEB)(?:\s*:[^\]]*)?\]/gi, '').trim() } : {}),
            metrics: msg.metrics,
          } : message))

          // Niveau 2 : Si le modèle a demandé un outil ([TOOL:PAGE], [TOOL:SCREEN], [TOOL:AUDIO], [WEB_SEARCH: ...])
          const fallback = pendingWebFallbackRef.current
          pendingWebFallbackRef.current = null
          if (fallback) {
            const finalAssistantText = stripThink(lastAssistantText)
            const customSearchQuery = extractModelWebSearchQuery(finalAssistantText) ?? undefined
            const requestedTool = detectModelToolCall(finalAssistantText, false)
            if (
              requestedTool &&
              (!fallback.onlyWebFallback || requestedTool === 'web') &&
              (!fallback.requireCustomQuery || Boolean(customSearchQuery))
            ) {
              // Replace the interrupted draft while the tool runs; it is not a final answer.
              setMessages(fallback.baseMessages)
              void executeAutoToolFallbackRef.current(
                requestedTool,
                fallback.query,
                fallback.baseMessages,
                fallback.attachments,
                customSearchQuery,
              )
              break
            }
          }

          break
        }
        case 'deleted':
          cachedModelsRef.current[msg.modelId] = false
          setCachedMap((prev) => ({ ...prev, [msg.modelId]: false }))
          if (loadedModelIdRef.current === msg.modelId) { loadedModelIdRef.current = null; setLoadedModelId(null) }
          break
        case 'error':
          generationRunRef.current.finish()
          if (msg.scope === 'load') pendingModelActionRef.current = null
          console.error(`[Locaya] ${msg.scope}:`, msg.message)
          setErrorMsg(msg.message)
          setLoadedModelIdLoading(null)
          pendingWebFallbackRef.current = null
          setSpeakingIdx(null)
          setGenerating((prev) => {
            if (prev) {
              setMessages((m) => {
                const n = [...m]
                const last = n[n.length - 1]
                if (last?.role === 'assistant') {
                  n[n.length - 1] = { ...last, failed: true }
                }
                return n
              })
            }
            return false
          })
          break
      }
    }

    worker.postMessage({ type: 'check', modelIds: readImportedModels().map(model => model.id) } satisfies WorkerRequest)
    return () => { worker.terminate(); startupCheckRef.current = false }
  }, [workerEpoch])

  // ─── Initialisation paresseuse du Web Worker Audio (Whisper multilingue local) ───
  const getAudioWorker = (): Worker => {
    if (!audioWorkerRef.current) {
      const aw = new Worker(new URL('./audioWorker.ts', import.meta.url), { type: 'module' })
      aw.onmessage = (event: MessageEvent<AudioWorkerResponse>) => {
        if (audioWorkerRef.current !== aw) return
        const msg = event.data
        if (msg.type === 'asr-cache') {
          setWhisperCached(msg.cached)
          setAudioModelInstalled(msg.installed ?? msg.cached)
          setAudioDevice(msg.device ?? null)
        } else if (msg.type === 'asr-ready') {
          whisperReadyRef.current = true
          setWhisperReady(true)
          setWhisperCached(true)
          setAudioModelInstalled(true)
          setAudioDevice(msg.device ?? null)
          setWhisperLoading(false)
          setAsrBusyText(null)
          setWhisperError(null)
          setShowWhisperSetup(false)
          if (pendingDictationRef.current) { pendingDictationRef.current = false; void startDictationRef.current() }
        } else if (msg.type === 'asr-progress') {
          setAsrBusyText(tr(msg.text))
          setWhisperProgress(msg.progress)
        } else if (msg.type === 'asr-result') {
          setAsrBusyText(null)
          if (msg.source === 'mic') setAudioMetrics({ elapsedMs: msg.elapsedMs, audioSeconds: msg.audioSeconds, device: msg.device })
          if (!msg.text) {
            setErrorMsg(tr("Aucune parole intelligible n'a été détectée dans l'enregistrement."))
            return
          }
          if (msg.source === 'mic') {
            setInput((prev) => (prev ? `${prev.trim()} ${msg.text}` : msg.text))
          } else if (msg.source === 'tab') {
            const title = tabAudioPageTitleRef.current
            const prompt =
              `Voici la transcription audio de l'onglet "${title}". ` +
              `Fais-en un résumé clair et structuré dans la langue de l'utilisateur :\n\n` +
              `"""\n${msg.text}\n"""`
            audioSummaryRef.current(prompt, title)
          }
        } else if (msg.type === 'asr-error') {
          pendingDictationRef.current = false
          whisperReadyRef.current = false
          setWhisperReady(false)
          setAsrBusyText(null)
          setWhisperLoading(false)
          setWhisperError(tr(msg.message))
          setShowWhisperSetup(true)
        }
      }
      aw.onerror = () => {
        if (audioWorkerRef.current !== aw) return
        audioJobRef.current++; pendingDictationRef.current = false
        aw.terminate(); audioWorkerRef.current = null
        whisperReadyRef.current = false; setWhisperReady(false)
        setWhisperLoading(false); setAsrBusyText(null)
        setWhisperError(tr('Le moteur de dictée a rencontré une erreur. Réessayez.'))
        setShowWhisperSetup(true)
      }
      audioWorkerRef.current = aw
    }
    return audioWorkerRef.current
  }

  const checkWhisper = () => getAudioWorker().postMessage({
    type: 'check', modelId: audioModelRef.current, backend: dictationBackendRef.current,
  } satisfies AudioWorkerRequest)

  useEffect(() => {
    checkWhisper()
    return () => { audioJobRef.current++; pendingDictationRef.current = false; micRecorderRef.current.cancel(); audioWorkerRef.current?.terminate(); audioWorkerRef.current = null }
  }, [])

  const prepareWhisper = () => {
    if (whisperLoading) return
    setWhisperError(null)
    setWhisperLoading(true)
    setShowWhisperSetup(true)
    setWhisperProgress(0)
    setAsrBusyText(tr("Préparation de la dictée…"))
    getAudioWorker().postMessage({
      type: 'load', modelId: audioModelRef.current, backend: dictationBackendRef.current, cachedOnly: whisperCached === true,
    } satisfies AudioWorkerRequest)
  }

  const requireWhisper = () => {
    if (whisperReadyRef.current) return true
    setShowWhisperSetup(true)
    if (whisperCached) prepareWhisper()
    return false
  }

  const cancelAudioTask = (recheck = true) => {
    audioJobRef.current++
    pendingDictationRef.current = false
    audioWorkerRef.current?.terminate()
    audioWorkerRef.current = null
    micRecorderRef.current.cancel()
    whisperReadyRef.current = false
    setWhisperReady(false)
    setWhisperLoading(false)
    setIsRecordingMic(false)
    setAsrBusyText(null)
    setShowWhisperSetup(false)
    setWhisperError(null)
    setWhisperCached(null)
    setAudioModelInstalled(false)
    setAudioDevice(null)
    setAudioMetrics(null)
    if (recheck) checkWhisper()
  }
  const changeDictationBackend = (value: DictationBackend) => {
    if (value === dictationBackendRef.current) return
    localStorage.setItem('localaiDictationBackend', value)
    dictationBackendRef.current = value
    setDictationBackend(value)
    cancelAudioTask()
  }
  const selectAudioModel = (id: string) => {
    const next = resolveAudioModelId(id)
    if (next === audioModelRef.current) return
    audioModelRef.current = next
    setAudioModelId(next)
    localStorage.setItem('localaiAudioModel', next)
    cancelAudioTask()
  }

  const importOwnAudioModel = async (files: File[]) => {
    const model = await importAudioModel(files)
    const next = [...importedAudioModels, model]
    try {
      localStorage.setItem('localaiImportedAudioModels', JSON.stringify(next))
    } catch (error) {
      await clearModelFiles(model.id)
      throw error
    }
    setImportedAudioModels(next)
    selectAudioModel(model.id)
  }

  // All visual entry points share one explicit download gate.
  const requireModel = (modelId: string, resume?: () => void) => {
    if (cachedModelsRef.current[modelId]) return true
    pendingModelActionRef.current = resume ?? null
    setRequestedModelId(modelId)
    return false
  }

  // Sauvegarde automatique de l'historique des conversations
  useEffect(() => {
    if (messages.length === 0) return
    const writeEpoch = historyWriteEpochRef.current
    const timeout = setTimeout(() => {
      setChatHistory((prev) => {
        if (writeEpoch !== historyWriteEpochRef.current) return prev
        let updated: ChatSession[]
        const existingIdx = prev.findIndex((c) => c.id === currentChatId)

        if (existingIdx !== -1) {
          // Ouvrir une conversation ne change pas sa date de dernière activité.
          if (prev[existingIdx].messages === messages) return prev
          updated = [...prev]
          updated[existingIdx] = {
            ...updated[existingIdx],
            messages,
            timestamp: Date.now(),
            modelId: selectedModelId,
          }
        } else {
          const newId = Date.now().toString()
          const firstText = textOf(messages[0].content) || messages[0].attachedFiles?.[0]?.fileName || tr("Discussion")
          const title = firstText.slice(0, 36) + (firstText.length > 36 ? '…' : '')
          setCurrentChatId(newId)
          updated = [{ id: newId, title, messages, timestamp: Date.now(), modelId: selectedModelId }, ...prev]
        }
        try {
          localStorage.setItem('chatHistory', JSON.stringify(updated))
        } catch {
          /* ignore quota */
        }
        return updated
      })
    }, 500)
    return () => clearTimeout(timeout)
  }, [messages, currentChatId, selectedModelId])

  const startNewChat = () => {
    if (generating || searchingWeb) return
    stopSpeaking()
    setSpeakingIdx(null)
    setCopiedMessageIdx(null)
    setMessages([])
    setCurrentChatId(null)
    setShowSidebar(false)
    setErrorMsg(null)
  }

  const loadChat = (chat: ChatSession) => {
    if (generating || searchingWeb) return
    stopSpeaking()
    setSpeakingIdx(null)
    setCopiedMessageIdx(null)
    setMessages(chat.messages)
    setCurrentChatId(chat.id)
    setSelectedModelId(textModelIdRef.current)
    setShowSidebar(false)
  }

  const deleteChat = (id: string) => {
    setChatHistory((prev) => {
      const updated = prev.filter((c) => c.id !== id)
      localStorage.setItem('chatHistory', JSON.stringify(updated))
      return updated
    })
    if (currentChatId === id) {
      setMessages([])
      setCurrentChatId(null)
    }
  }

  const updateChat = (id: string, update: Partial<ChatSession> | ((chat: ChatSession) => Partial<ChatSession>)) => {
    setChatHistory(previous => {
      const next = previous.map(chat => chat.id === id ? { ...chat, ...(typeof update === 'function' ? update(chat) : update) } : chat)
      localStorage.setItem('chatHistory', JSON.stringify(next))
      return next
    })
  }

  const saveModelSettings = (id: string, value: ModelSettings) => {
    const next = normalizeModelSettings(value)
    modelSettingsRef.current = { ...modelSettingsRef.current, [id]: next }
    setModelSettings(modelSettingsRef.current)
    localStorage.setItem('localaiModelSettings', JSON.stringify(modelSettingsRef.current))
  }

  const selectTextModel = (id: string) => {
    if (id === textModelIdRef.current) return
    hadSavedModelChoiceRef.current = true
    textModelIdRef.current = id
    setTextModelId(id)
    setSelectedModelId(id)
    setErrorMsg(null)
    const available = !!cachedModelsRef.current[id]
    startupReadyRef.current = available
    setStartupReady(available)
    setRequestedModelId(available ? null : id)
    localStorage.setItem('localaiTextModel', id)
  }
  const closeSettings = () => {
    setShowSettings(false)
  }
  const handleSettingsAction = async (action: SettingsAction) => {
    if (action === 'conversations') {
      historyWriteEpochRef.current++
      stopSpeaking(); setSpeakingIdx(null); setCopiedMessageIdx(null)
      messagesRef.current = []
      setMessages([]); setCurrentChatId(null); setChatHistory([])
      localStorage.setItem('chatHistory', '[]')
      return
    }
    if (action === 'reset') {
      modelSettingsRef.current = {}; setModelSettings({})
      localStorage.removeItem('localaiDeveloperOptions')
      localStorage.removeItem('localaiSpeechVoice')
      stopSpeaking(); setSpeakingIdx(null)
      setWebSettings(DEFAULT_WEB_SETTINGS)
      localStorage.setItem('localaiModelSettings', '{}')
      selectTextModel(DEFAULT_MODEL_ID)
      selectAudioModel(DEFAULT_AUDIO_MODEL)
      changeDictationLanguage('auto')
      changeDictationBackend('auto')
      changeMicDevice('')
      setAudioMetrics(null)
      setThinkingEnabled(false); setDark(true); resetLanguage()
      setSelectedModelId(DEFAULT_MODEL_ID)
      localStorage.setItem('localaiThinkingEnabled', 'false'); localStorage.setItem('localaiTheme', 'dark')
      return
    }
    const audioOnly = action === 'audio-model'
    if (audioOnly && !audioModelInstalled) return
    if (action === 'model' && !cachedModelsRef.current[textModelIdRef.current]) return
    if (audioOnly || action === 'models') cancelAudioTask(false)
    if (action === 'models') { stopSpeaking(); setSpeakingIdx(null) }
    if (!audioOnly) {
      workerRef.current?.terminate(); workerRef.current = null
      loadedModelIdRef.current = null
      startupReadyRef.current = false; startupCheckRef.current = false
      setStartupReady(false); setLoadedModelId(null); setCacheChecked(false)
      setErrorMsg(null); pendingModelActionRef.current = null
    }
    try {
      await clearModelFiles(audioOnly ? audioModelRef.current : action === 'models' ? undefined : textModelIdRef.current)
      if (action === 'models' || (audioOnly && importedAudioDtype(audioModelRef.current))) {
        const remaining = action === 'models' ? [] : importedAudioModels.filter(model => model.id !== audioModelRef.current)
        localStorage.setItem('localaiImportedAudioModels', JSON.stringify(remaining))
        setImportedAudioModels(remaining)
        if (importedAudioDtype(audioModelRef.current)) {
          audioModelRef.current = DEFAULT_AUDIO_MODEL
          setAudioModelId(DEFAULT_AUDIO_MODEL)
          localStorage.setItem('localaiAudioModel', DEFAULT_AUDIO_MODEL)
        }
      }
      if (action === 'models' || textModelIdRef.current.startsWith('custom-') && !audioOnly) {
        const removed = action === 'models' ? importedModels.map(model => model.id) : [textModelIdRef.current]
        const remaining = importedModels.filter(model => !removed.includes(model.id))
        setImportedModels(remaining)
        localStorage.setItem('localaiImportedModels', JSON.stringify(remaining))
        const next = Object.fromEntries(Object.entries(modelSettingsRef.current).filter(([id]) => !removed.includes(id)))
        modelSettingsRef.current = next; setModelSettings(next)
        localStorage.setItem('localaiModelSettings', JSON.stringify(next))
        selectTextModel(DEFAULT_MODEL_ID)
      }
    } finally {
      if (audioOnly || action === 'models') checkWhisper()
      if (!audioOnly) {
        cachedModelsRef.current = {}; setCachedMap({})
        setRequestedModelId(textModelIdRef.current)
        setWorkerEpoch(epoch => epoch + 1)
      }
    }
  }

  const importOwnModel = (file: File) => {
    hadSavedModelChoiceRef.current = true
    const id = `custom-${crypto.randomUUID()}`
    const entry = { id, name: file.name.replace(/\.gguf$/i, ''), bytes: file.size }
    setImportedModels(previous => [...previous, entry])
    setRequestedModelId(id)
    pendingModelActionRef.current = () => { textModelIdRef.current = id; setTextModelId(id); setSelectedModelId(id) }
    setErrorMsg(null)
    setLoadedModelIdLoading(id)
    setLoadPhase('import')
    setProgress(0)
    postToWorker({ type: 'load', modelId: id, file, settings: settingsForModel(id, modelSettingsRef.current[id]) })
  }

  const rollbackAndEdit = (index: number) => {
    if (generating || loading) return
    setInput(textOf(messages[index].content))
    setAttachments(messages[index].attachedFiles ?? [])
    setMessages((prev) => prev.slice(0, index))
  }

  // ─── Import de fichiers (Images, PDF, Fichiers de Code/Texte) ───
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const files = Array.from(e.target.files)

    for (const file of files) {
      const id = Date.now().toString() + Math.random().toString(36).substring(7)

      if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Erreur lecture image'))
          reader.readAsDataURL(file)
        })
        setAttachments((prev) => [...prev, { id, fileName: file.name, type: 'image', content: dataUrl }])
        requireModel(VISION_MODEL_ID)
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          setPdfExtractionStatus(`Ouverture de ${file.name}…`)
          const arrayBuffer = await file.arrayBuffer()
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
          const pages: { pageNumber: number; text: string }[] = []

          for (let i = 1; i <= pdf.numPages; i++) {
            setPdfExtractionStatus(`Lecture du PDF (${i}/${pdf.numPages} pages)…`)
            const page = await pdf.getPage(i)
            const textContent = await page.getTextContent()
            const pageText = textContent.items.map((item: any) => item.str).join(' ')
            pages.push({ pageNumber: i, text: pageText })
          }

          const structured = buildStructuredPdfDocument(file.name, pages)
          setAttachments((prev) => [
            ...prev,
            {
              id,
              fileName: file.name,
              type: 'pdf',
              content: structured.fullText,
              outline: structured.outline,
              pageCount: structured.pageCount,
              estimatedTokens: structured.estimatedTokens,
            },
          ])
        } catch (err) {
          console.error('Erreur lecture PDF', err)
          setErrorMsg(`Impossible de lire le PDF "${file.name}".`)
        } finally {
          setPdfExtractionStatus(null)
        }
      } else {
        try {
          const text = await file.text()
          const isCode = isCodeFileName(file.name)
          const codeMeta = extractCodeOutline(text, file.name)
          setAttachments((prev) => [
            ...prev,
            {
              id,
              fileName: file.name,
              type: isCode ? 'code' : 'text',
              content: text,
              outline: codeMeta.outline,
              lineCount: codeMeta.lineCount,
              estimatedTokens: codeMeta.estimatedTokens,
            },
          ])
        } catch (err) {
          console.error('Erreur lecture fichier', err)
          setErrorMsg(`Impossible de lire le fichier "${file.name}".`)
        }
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const downloadModel = (modelIdToLoad = selectedModelId) => {
    if (loading) return
    hadSavedModelChoiceRef.current = true
    if (modelIdToLoad !== VISION_MODEL_ID && !modelIdToLoad.startsWith('custom-')) localStorage.setItem('localaiTextModel', modelIdToLoad)
    setErrorMsg(null)
    setLoadedModelIdLoading(modelIdToLoad)
    setProgress(0)
    setLoadPhase(cachedModelsRef.current[modelIdToLoad] ? 'warmup' : 'download')
    postToWorker({ type: 'load', modelId: modelIdToLoad, settings: settingsForModel(modelIdToLoad, modelSettingsRef.current[modelIdToLoad]) })
  }

  const toChatTurns = (history: ChatMessage[]): { turns: ChatTurn[]; lastRagBadge?: string } => {
    const turns: ChatTurn[] = []
    let lastRagBadge: string | undefined

    for (let i = 0; i < history.length; i++) {
      const msg = history[i]
      if (msg.role === 'assistant') {
        const cleanedAnswer = stripThink(textOf(msg.content))
          .replace(/[^.!?\n]*\bje vais (?:effectuer|faire|lancer) une recherche[^.!?\n]*[.!?]?/gi, '')
          .replace(/[^.!?\n]*\bi (?:will|am going to) (?:perform|conduct|run|do) a (?:real-time )?(?:web )?search[^.!?\n]*[.!?]?/gi, '')
          .trim()
        if (cleanedAnswer && !cleanedAnswer.startsWith('Erreur :')) {
          turns.push({ role: 'assistant', content: cleanedAnswer })
        }
        continue
      }

      const rawUserText = textOf(msg.content)
      const atts = msg.attachedFiles ?? []
      const imgUrls = atts.filter((a) => a.type === 'image').map((a) => a.content)
      const docAtts = atts.filter((a) => a.type !== 'image')

      let finalContent = rawUserText
      if (docAtts.length > 0) {
        // Reserve room for the question and visual tokens.
        const smart = buildSmartAttachmentContext(docAtts, rawUserText || 'Synthèse et analyse complète', imgUrls.length ? 600 : 1800)
        finalContent = [smart.contextText, rawUserText].filter(Boolean).join('\n\n')
        if (i === history.length - 1 && smart.wasRagApplied) {
          lastRagBadge = `${smart.selectedChunks} extraits clés analysés`
        }
      }

      if (finalContent || imgUrls.length > 0) {
        turns.push({
          role: 'user',
          content: finalContent || 'Analyse cette image.',
          ...(imgUrls.length > 0 ? { images: imgUrls } : {}),
        })
      }
    }

    return { turns, lastRagBadge }
  }

  const runPromptImmediately = (
    promptText: string,
    customAttachments: Attachment[] = attachments,
    overrideModelId?: string,
    displayPromptOverride?: string,
    webSources?: WebSearchSource[],
    displayAttachmentsOverride?: Attachment[],
    baseMessagesOverride?: ChatMessage[],
    autoToolLabel?: string,
    researchSteps?: string[],
    sentAt = Date.now(),
    webEvidence?: WebSearchOutcome['evidence'],
  ) => {
    if (!startupReadyRef.current || generationRunRef.current.active || loading) return
    const baseHistory = baseMessagesOverride ?? messages
    const visualFollowUp = !autoToolLabel && continuesVisualContext(displayPromptOverride || promptText, baseHistory.map((message) => ({
      role: message.role, text: originalRequest(textOf(message.content), message.originalUserText),
      hasImages: !!message.attachedFiles?.some((a) => a.type === 'image'),
    })))
    const hasImages = customAttachments.some((a) => a.type === 'image') || !!visualFollowUp
    const targetModelId =
      overrideModelId ?? modelForRequest(hasImages, textModelIdRef.current)
    if (!requireModel(targetModelId, () => runPromptImmediately(promptText, customAttachments, overrideModelId,
      displayPromptOverride, webSources, displayAttachmentsOverride, baseMessagesOverride, autoToolLabel, researchSteps, sentAt, webEvidence))) return

    if (targetModelId !== selectedModelId) {
      setSelectedModelId(targetModelId)
    }

    const userMsgForEngine: ChatMessage = {
      role: 'user',
      content: promptText,
      originalUserText: originalRequest(promptText, displayPromptOverride),
      attachedFiles: customAttachments,
    }
    const freshEvidence = !!autoToolLabel || webSources !== undefined
    const relevantHistory = selectRequestHistory(baseHistory, userMsgForEngine.originalUserText || promptText, freshEvidence,
      (message) => originalRequest(textOf(message.content), message.originalUserText))
    const engineHistory = [...relevantHistory.map((message) => freshEvidence
      ? { ...message, content: originalRequest(textOf(message.content), message.originalUserText), attachedFiles: undefined, webSources: undefined }
      : message), userMsgForEngine]
    const { turns, lastRagBadge } = toChatTurns(engineHistory)

    const userMsgForDisplay: ChatMessage = {
      role: 'user',
      content: displayPromptOverride || promptText,
      originalUserText: originalRequest(promptText, displayPromptOverride),
      attachedFiles: displayAttachmentsOverride ?? customAttachments,
      ragBadge: lastRagBadge,
      webSources,
      researchSteps,
      sentAt,
      autoToolLabel,
    }

    const enableThinking = thinkingEnabled && !getModelSpec(targetModelId).isVision && getModelSpec(targetModelId).supportsThinking !== false
    setMessages([...baseHistory, userMsgForDisplay, { role: 'assistant', content: '', thinking: enableThinking }])
    setInput('')
    setAttachments([])
    setErrorMsg(null)
    setStatusBanner(null)
    setGenerating(true)
    const requestId = generationRunRef.current.start()
    lastRawStreamedTextRef.current = ''

    postToWorker({
      type: 'generate',
      requestId,
      allowTools: pendingWebFallbackRef.current !== null,
      modelId: targetModelId,
      messages: turns,
      enableThinking,
      settings: settingsForModel(targetModelId, modelSettingsRef.current[targetModelId]),
      webEvidence,
    })
  }

  audioSummaryRef.current = (prompt, title) => runPromptImmediately(prompt, [], undefined, `🎧 Résumé audio : ${title.slice(0, 40)}`)

  const executeWebSearchAndRun = async (
    rawQuery: string,
    baseMessagesOverride?: ChatMessage[],
    baseAttachmentsOverride?: Attachment[],
    overrideSearchQuery?: string,
    resolvedQuestion?: string,
  ) => {
    if (!startupReadyRef.current || loading || searchingWeb) return
    const query = rawQuery.trim()
    if (!query) return

    pendingWebFallbackRef.current = null
    const baseHistory = baseMessagesOverride ?? messages
    const userAtts = [...(baseAttachmentsOverride ?? attachments)]
    const sentAt = Date.now()
    const saveSearchReply = (content: string, researchSteps?: string[], electionScope?: ChatMessage['electionScope']) => {
      setMessages([...baseHistory,
        { role: 'user', content: query, sentAt, attachedFiles: userAtts, researchSteps },
        { role: 'assistant', content, sentAt: Date.now(), electionScope },
      ])
    }

    // Reconstruit la requête en tenant compte du sujet des messages précédents (ex: "Epsilon France" + "Je cherche son numéro...")
    const historyForContext = baseHistory.map((m) => ({
      role: m.role,
      text: originalRequest(stripThink(textOf(m.content)), m.originalUserText),
    }))
    const scopeLanguage = !resolvedQuestion ? presidentialQuestionLanguage(query) : undefined
    if (scopeLanguage) {
      const previous = historyForContext.findLast(turn => turn.role === 'user')?.text ?? ''
      const country = previousElectionCountry(previous, scopeLanguage)
      if (!country) {
        setErrorMsg(null)
        saveSearchReply(scopeLanguage === 'fr'
          ? 'De quel pays parles-tu ? Le calendrier de la présidentielle dépend du pays.'
          : 'Which country do you mean? The presidential election calendar depends on the country.', undefined, scopeLanguage)
        return
      }
      resolvedQuestion = scopeElectionQuestion(query, country)
    }
    const question = resolvedQuestion ?? query
    const contextualUserQuery = resolvedQuestion ?? buildContextualWebQuery(query, historyForContext)
    const calendar = electionCalendarLookup(question)
    const effectiveSearchQuery = calendar?.query ?? (overrideSearchQuery && !resolvedQuestion
      ? `${overrideSearchQuery.trim()} ${
          contextualUserQuery.toLowerCase().includes(overrideSearchQuery.trim().toLowerCase())
            ? ''
            : contextualUserQuery
        }`.trim()
      : contextualUserQuery)

    setErrorMsg(null)
    setSearchingWeb(true)
    const researchSteps: string[] = []
    const recordResearchStep = (step: string) => {
      if (researchSteps.at(-1) === step) return
      researchSteps.push(step)
      setWebResearch({ query, steps: [...researchSteps], sentAt })
    }
    const urls = extractUrlsFromText(effectiveSearchQuery)
    recordResearchStep(urls.length ? `${tr('Lecture de liens')} · ${urls.join(' · ')}` : `${tr('Requête web')} · ${compactWebQuery(effectiveSearchQuery)}`)
    setStatusBanner(null)

    const answerWithoutSources = () => {
      setSearchingWeb(false)
      setStatusBanner(null)
      const prompt = urls.length
        ? `${question}\n\nThe linked pages could not be read. Answer any general question from your own knowledge in the user's language. Do not summarize or claim to have read those pages.`
        : question
      runPromptImmediately(prompt, userAtts, undefined, query, undefined, userAtts, baseHistory, undefined, [...researchSteps], sentAt)
    }

    try {
      const outcome = await performWebResearch(effectiveSearchQuery, recordResearchStep, createResearchProviders(webSettings), extractActivePageContent, calendar)
      recordResearchStep(outcome.sources.length ? `${outcome.sources.length} · ${tr('Sources retenues')}` : tr('Aucune source exploitable'))
      setSearchingWeb(false)
      setStatusBanner(null)

      // A search is followed by an answer, never another search loop.
      pendingWebFallbackRef.current = null

      if (outcome.sources.length === 0) {
        answerWithoutSources()
        return
      }

      const electionCheck = isPresidentialLookup(question)
        ? '\n\nCheck the country, office and election year in the sources. If the requested year is a mistaken premise, explain what year the sources actually establish. Do not treat hypothetical poll candidates as confirmed candidates.'
        : ''
      const enrichedPrompt =
        `${outcome.contextHeader}\n\n` +
        `User question: ${question}\n` +
        `(Answer directly now in the exact same language as the user's question using the sources above.)`
        + electionCheck
      const combinedAttachments = [...userAtts, ...outcome.attachments]

      runPromptImmediately(
        enrichedPrompt,
        combinedAttachments,
        undefined,
        query,
        outcome.sources,
        baseAttachmentsOverride ?? attachments,
        baseMessagesOverride,
        '🔎 Recherche Web automatique',
        [...researchSteps],
        sentAt,
        outcome.evidence,
      )
    } catch {
      recordResearchStep(tr('Échec de la recherche web'))
      answerWithoutSources()
    }
  }

  // ─── Résumer / Aider sur la page web active ───
  const handleSummarizeActivePage = async (
    customQuery?: string,
    baseMessagesOverride?: ChatMessage[],
    baseAttachmentsOverride?: Attachment[],
  ) => {
    if (!startupReadyRef.current || loading) return
    const userAtts = baseAttachmentsOverride ?? attachments
    setErrorMsg(null)
    setStatusBanner(tr('Lecture automatique de la page ouverte…'))
    try {
      const page = await extractActivePageContent()
      setStatusBanner(null)

      const userCustomQuestion = (customQuery ?? input).trim()
      const selectionRequested = /s[eé]lection|surlign|selected|highlight/i.test(userCustomQuestion)
      const count = countRequestedWord(userCustomQuestion, selectionRequested ? page.selectedText || '' : page.markdown)
      if (count) {
        const scope = selectionRequested ? 'la sélection' : 'le texte extrait de la page'
        setMessages([...(baseMessagesOverride ?? messages), { role: 'user', content: userCustomQuestion, sentAt: Date.now() },
          { role: 'assistant', content: `Le mot « ${count.word} » apparaît **${count.count} fois** dans ${scope} « ${page.title} ». Le comptage ignore les majuscules et ne compte que le mot entier.`, sentAt: Date.now() }])
        setInput('')
        pendingWebFallbackRef.current = null
        return
      }
      if (selectionRequested && page.selectedText && page.selectedText.length > 20) {
        const prompt =
          (userCustomQuestion
            ? `${userCustomQuestion}\n\nPassage sélectionné sur "${page.title}" (${page.url}) :\n`
            : `Explique et résume clairement ce passage sélectionné sur la page "${page.title}" (${page.url}) :\n\n`) +
          `"""\n${page.selectedText}\n"""`
        pendingWebFallbackRef.current = webSearchEnabled
          ? {
              query: `${userCustomQuestion || ''} ${page.title}`.trim(),
              baseMessages: baseMessagesOverride ? [...baseMessagesOverride] : [...messages],
              attachments: [...userAtts],
              onlyWebFallback: true,
            }
          : null
        runPromptImmediately(
          prompt,
          userAtts,
          undefined,
          userCustomQuestion || `🌐 Résumer la sélection sur « ${page.title.slice(0, 40)} »`,
          undefined,
          userAtts,
          baseMessagesOverride,
          `🌐 Sélection lue sur « ${page.title.slice(0, 32)} »`,
        )
      } else {
        const pageAttachment: Attachment = {
          id: 'page-' + Date.now(),
          fileName: `${page.title.slice(0, 40)}.md`,
          type: 'text',
          content: `# ${page.title}\nSource : ${page.url}\n\n${page.markdown}`,
          estimatedTokens: Math.ceil(page.charCount / 3.8),
        }
        const prompt =
          userCustomQuestion ||
          `Fais un résumé clair et structuré de la page "${page.title}" : ` +
            `présente l'essentiel, les points clés et ce qu'il faut retenir.`
        pendingWebFallbackRef.current = webSearchEnabled
          ? {
              query: `${userCustomQuestion || ''} ${page.title}`.trim(),
              baseMessages: baseMessagesOverride ? [...baseMessagesOverride] : [...messages],
              attachments: [...userAtts, pageAttachment],
              onlyWebFallback: true,
            }
          : null
        runPromptImmediately(
          prompt,
          [...userAtts, pageAttachment],
          undefined,
          userCustomQuestion || `🌐 Résumer la page « ${page.title.slice(0, 42)} »`,
          undefined,
          userAtts,
          baseMessagesOverride,
          `🌐 Page « ${page.title.slice(0, 32)} » consultée`,
        )
      }
    } catch (err: any) {
      setStatusBanner(null)
      setErrorMsg(err?.message || 'Impossible de lire cette page.')
    }
  }

  // ─── Capture d'écran de l'onglet + Actions Vision ───
  const handleCaptureTabToAttachments = async (runDefaultAnalysis = false) => {
    if (!startupReadyRef.current || generating || loading) return
    if (!requireModel(VISION_MODEL_ID, () => { void handleCaptureTabToAttachments(runDefaultAnalysis) })) return
    setErrorMsg(null)
    setStatusBanner(tr("Capture de l'écran en cours…"))
    try {
      const shot = await captureActiveTabScreenshot()
      setStatusBanner(null)
      const imgAtt: Attachment = {
        id: 'shot-' + Date.now(),
        fileName: `Écran - ${shot.title.slice(0, 26)}.png`,
        type: 'image',
        content: shot.dataUrl,
      }
      setSelectedModelId('lfm3-omni-2b')
      if (runDefaultAnalysis || input.trim()) {
        const prompt =
          input.trim() ||
          `Explique clairement ce qui est affiché sur cette capture d'écran de "${shot.title}" et résume les informations importantes.`
        runPromptImmediately(
          prompt,
          [...attachments.filter((a) => a.type !== 'image'), imgAtt],
          'lfm3-omni-2b',
          input.trim() || `📸 Analyser l'écran « ${shot.title.slice(0, 35)} »`,
          undefined,
          undefined,
          undefined,
          `📸 Capture d'écran analysée`,
        )
      } else {
        setAttachments((prev) => [...prev.filter((a) => a.type !== 'image'), imgAtt])
      }
    } catch (err: any) {
      setStatusBanner(null)
      setErrorMsg(err?.message || tr("Impossible de capturer l'écran de cet onglet."))
    }
  }

  const handleCaptureAndRunVisionPrompt = async (
    visionPrompt: string,
    shortLabel?: string,
    baseMessagesOverride?: ChatMessage[],
    baseAttachmentsOverride?: Attachment[],
  ) => {
    if (!startupReadyRef.current || loading) return
    if (!requireModel(VISION_MODEL_ID, () => { void handleCaptureAndRunVisionPrompt(visionPrompt, shortLabel, baseMessagesOverride, baseAttachmentsOverride) })) return
    pendingWebFallbackRef.current = null
    setErrorMsg(null)
    try {
      let currentAttachments = [...(baseAttachmentsOverride ?? attachments)]
      const hasImage = currentAttachments.some((a) => a.type === 'image')
      if (!hasImage) {
        setStatusBanner(tr("Capture automatique de l'écran…"))
        const shot = await captureActiveTabScreenshot()
        setStatusBanner(null)
        currentAttachments.push({
          id: 'shot-' + Date.now(),
          fileName: `Écran - ${shot.title.slice(0, 26)}.png`,
          type: 'image',
          content: shot.dataUrl,
        })
      }
      setSelectedModelId('lfm3-omni-2b')
      runPromptImmediately(
        visionPrompt,
        currentAttachments,
        'lfm3-omni-2b',
        shortLabel || visionPrompt,
        undefined,
        currentAttachments,
        baseMessagesOverride,
        "📸 Capture d'écran automatique",
      )
    } catch (err: any) {
      setStatusBanner(null)
      setErrorMsg(err?.message || tr("Impossible de capturer l'écran."))
    }
  }

  const handleToggleMicDictation = async () => {
    if (!startupReadyRef.current || generating || loading) return
    if (!isRecordingMic && !whisperReadyRef.current) {
      pendingDictationRef.current = true
      requireWhisper()
      return
    }
    setWhisperError(null)
    setErrorMsg(null)

    if (isRecordingMic) {
      const job = ++audioJobRef.current
      try {
        setIsRecordingMic(false)
        setAsrBusyText(tr("Transcription vocale multilingue…"))
        const pcm16k = await micRecorderRef.current.stop()
        if (job !== audioJobRef.current) return
        const aw = getAudioWorker()
        const req: AudioWorkerRequest = {
          type: 'transcribe',
          audio: pcm16k,
          modelId: audioModelRef.current,
          source: 'mic',
          dictationLanguage,
        }
        aw.postMessage(req, [pcm16k.buffer])
      } catch (err: any) {
        if (job !== audioJobRef.current) return
        setAsrBusyText(null)
        setWhisperError(err?.message || tr("Erreur lors de la dictée vocale."))
      }
    } else {
      await startDictationRef.current()
    }
  }

  startDictationRef.current = async () => {
    if (micStartingRef.current || micRecorderRef.current.isRecording || !startupReadyRef.current || generationRunRef.current.active) return
    micStartingRef.current = true
    setWhisperError(null)
    try {
      stopSpeaking()
      setSpeakingIdx(null)
      await micRecorderRef.current.start(micDeviceId)
      setShowWhisperSetup(false)
      setIsRecordingMic(true)
    } catch (err: any) {
      setIsRecordingMic(false)
      if (err?.name !== 'AbortError') setWhisperError(err?.message || tr("Accès au microphone refusé. Autorisez le microphone dans la fenêtre qui s'est ouverte."))
    } finally { micStartingRef.current = false }
  }

  const handleSpeakMessage = (idx: number, content: string) => {
    if (speakingIdx === idx) {
      stopSpeaking()
      setSpeakingIdx(null)
      return
    }
    setSpeakingIdx(idx)
    speakMarkdownText(content, {
      onEnd: () => setSpeakingIdx(null),
      onError: (err) => {
        setSpeakingIdx(null)
        setErrorMsg(err)
      },
    })
  }

  const copyMessage = async (idx: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessageIdx(idx)
    } catch {
      setErrorMsg(tr("Impossible de copier le message. Réessayez."))
    }
  }

  // ─── Résumé Audio / Vidéo de l'onglet ───
  const handleTabAudioAction = async (
    customQuery?: string,
    baseMessagesOverride?: ChatMessage[],
    baseAttachmentsOverride?: Attachment[],
  ) => {
    if (!startupReadyRef.current || loading) return
    pendingWebFallbackRef.current = null
    const userAtts = baseAttachmentsOverride ?? attachments
    setErrorMsg(null)

    if (isCapturingTabAudio) {
      await handleStopTabAudioAndSummarize()
      return
    }

    setStatusBanner(tr("Recherche des sous-titres ou de l'audio de la vidéo…"))
    try {
      const info = await extractActiveTabAudioTranscript()
      setStatusBanner(null)
      tabAudioPageTitleRef.current = info.title

      const userCustomQuestion = (customQuery ?? input).trim()
      if (info.hasTranscript && info.transcriptText) {
        const transcriptAtt: Attachment = {
          id: 'transcript-' + Date.now(),
          fileName: `Transcription - ${info.title.slice(0, 32)}.txt`,
          type: 'text',
          content: `${info.mediaSummary}\nSource : ${info.transcriptSource}\n\n${info.transcriptText}`,
          estimatedTokens: Math.ceil(info.transcriptText.length / 3.8),
        }
        const prompt =
          userCustomQuestion ||
          `Voici la transcription de "${info.title}". ` +
            `Fais un résumé clair et structuré avec le sujet principal, les points clés et la conclusion.`
        runPromptImmediately(
          prompt,
          [...userAtts, transcriptAtt],
          undefined,
          userCustomQuestion || `🎧 Résumer la vidéo « ${info.title.slice(0, 38)} »`,
          undefined,
          userAtts,
          baseMessagesOverride,
          `🎧 Transcription vidéo « ${info.title.slice(0, 28)} » consultée`,
        )
        return
      }

      if (!requireWhisper()) return
      await tabAudioControllerRef.current.start()
      setIsCapturingTabAudio(true)
    } catch (err: any) {
      setStatusBanner(null)
      setErrorMsg(err?.message || tr("Impossible de récupérer l'audio de cet onglet."))
    }
  }

  // Routeur unifié d'appel automatique aux outils (Niveau 1 : intention directe / Niveau 2 : appel du modèle)
  const executeAutoTool = async (
    tool: NonNullable<AutoToolType>,
    rawQuery: string,
    baseMessagesOverride?: ChatMessage[],
    baseAttachmentsOverride?: Attachment[],
    overrideSearchQuery?: string,
  ) => {
    if (tool === 'page') {
      await handleSummarizeActivePage(rawQuery, baseMessagesOverride, baseAttachmentsOverride)
    } else if (tool === 'screen') {
      await handleCaptureAndRunVisionPrompt(rawQuery, rawQuery, baseMessagesOverride, baseAttachmentsOverride)
    } else if (tool === 'audio') {
      await handleTabAudioAction(rawQuery, baseMessagesOverride, baseAttachmentsOverride)
    } else if (tool === 'web') {
      await executeWebSearchAndRun(rawQuery, baseMessagesOverride, baseAttachmentsOverride, overrideSearchQuery)
    }
  }
  executeAutoToolFallbackRef.current = executeAutoTool

  const submitUserQuery = async (rawText: string) => {
    if (!startupReadyRef.current) return
    if ((!rawText.trim() && attachments.length === 0) || generating || loading || searchingWeb || isRecordingMic || !!asrBusyText) return
    const hasImage = attachments.some((a) => a.type === 'image')
    if (hasImage && !requireModel(VISION_MODEL_ID, () => { void submitUserQuery(rawText) })) return
    if (!hasImage && loadedModelIdRef.current !== textModelIdRef.current) {
      const id = textModelIdRef.current
      pendingModelActionRef.current = () => { void submitUserQuery(rawText) }
      setLoadedModelIdLoading(id)
      setLoadPhase('warmup')
      setProgress(0)
      postToWorker({ type: 'load', modelId: id, settings: settingsForModel(id, modelSettingsRef.current[id]) })
      return
    }
    const trimmed = rawText.trim()

    const last = messages.at(-1)
    const clarification = messages.at(-2)
    if (!attachments.length && last?.electionScope && clarification?.role === 'user') {
      const country = electionCountryFromReply(trimmed, last.electionScope)
      if (country) {
        await executeWebSearchAndRun(trimmed, undefined, undefined, undefined, scopeElectionQuestion(textOf(clarification.content), country))
        return
      }
    }

    const calculated = attachments.length === 0 ? exactPercentage(trimmed) : undefined
    if (calculated !== undefined) {
      pendingWebFallbackRef.current = null
      setErrorMsg(null)
      const sentAt = Date.now()
      setMessages([...messages, { role: 'user', content: trimmed, sentAt }, { role: 'assistant', content: calculated, sentAt }])
      return
    }

    // Niveau 1 : Détection automatique de l'outil adéquat (Page, Écran, Audio/Vidéo ou Recherche Web)
    if (trimmed) {
      const autoTool = detectAutoToolIntent(trimmed, attachments.length > 0, webSearchEnabled)
      if (autoTool) {
        await executeAutoTool(autoTool, trimmed)
        return
      }
      if (webSearchEnabled && !attachments.length && /^(?:(?:et|and)\s+)?(?:en|in)\s+\d{4}[\s?.!]*$/i.test(trimmed)) {
        const contextual = buildContextualWebQuery(trimmed, messages.map(message => ({
          role: message.role,
          text: originalRequest(textOf(message.content), message.originalUserText),
        })))
        if (contextual !== trimmed && shouldTriggerWebSearch(contextual)) {
          await executeWebSearchAndRun(trimmed)
          return
        }
      }
    }

    // Niveau 2 : Si aucun outil n'a été déclenché en amont, le modèle peut appeler lui-même [TOOL:PAGE], [TOOL:SCREEN], [TOOL:AUDIO] ou [WEB_SEARCH: requête]
    if (trimmed && !isAssistantIdentityQuestion(trimmed) && !isGeneralDefinition(trimmed)) {
      pendingWebFallbackRef.current = {
        query: trimmed,
        baseMessages: [...messages],
        attachments: [...attachments],
        onlyWebFallback: attachments.length > 0,
      }
    } else {
      pendingWebFallbackRef.current = null
    }

    const defaultPrompt =
      attachments.some((a) => a.type === 'image')
        ? 'Décris et explique en détail cette image.'
        : 'Résume et explique clairement le document joint.'
    runPromptImmediately(trimmed || defaultPrompt, attachments)
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitUserQuery(input)
  }

  const stopGeneration = () => {
    pendingWebFallbackRef.current = null
    if (generationRunRef.current.requestStop()) postToWorker({ type: 'interrupt', requestId: generationRunRef.current.id })
  }

  const handleStopTabAudioAndSummarize = async () => {
    const job = ++audioJobRef.current
    try {
      setIsCapturingTabAudio(false)
      setAsrBusyText(tr("Transcription de l'audio écouté…"))
      const pcm16k = await tabAudioControllerRef.current.stop()
      if (job !== audioJobRef.current) return
      const aw = getAudioWorker()
      const req: AudioWorkerRequest = {
        type: 'transcribe',
        audio: pcm16k,
        modelId: audioModelRef.current,
        source: 'tab',
      }
      aw.postMessage(req, [pcm16k.buffer])
    } catch (err: any) {
      if (job !== audioJobRef.current) return
      setAsrBusyText(null)
      setErrorMsg(err?.message || tr("Erreur lors de l'arrêt de l'écoute audio."))
    }
  }

  const hasImageAttachment = attachments.some((a) => a.type === 'image')
  const hasDocAttachments = attachments.some((a) => a.type === 'pdf' || a.type === 'code' || a.type === 'text')


  return (
    <div
      className={`localai-shell flex flex-col h-screen font-sans transition-colors duration-300 relative overflow-hidden ${
        dark ? 'dark bg-[#171717] text-[#ececec]' : 'bg-[#faf9f6] text-slate-800'
      }`}
    >
      <ConversationSidebar open={showSidebar} onClose={() => setShowSidebar(false)} chats={chatHistory}
        currentId={currentChatId} busy={loading || generating || searchingWeb || isRecordingMic}
        onNew={startNewChat} onOpen={loadChat} onSettings={() => setShowSettings(true)}
        onRename={(id, title) => updateChat(id, { title })} onPin={id => updateChat(id, chat => ({ pinned: !chat.pinned }))} onDelete={deleteChat} />
      <SettingsDialog open={showSettings} onClose={closeSettings} language={languagePreference} onLanguage={setLanguage}
        web={webSettings} onWeb={setWebSettings}
        models={modelCatalog} selectedModelId={textModelId} settings={modelSettings} onSave={saveModelSettings} onImport={importOwnModel}
        textModelInstalled={!!cachedMap[textModelId]} audioModelInstalled={audioModelInstalled}
        importedAudioModels={importedAudioModels} onImportAudio={importOwnAudioModel}
        dictationLanguage={dictationLanguage} onDictationLanguage={changeDictationLanguage}
        dictationBackend={dictationBackend} onDictationBackend={changeDictationBackend} audioDevice={audioDevice}
        micDeviceId={micDeviceId} onMicDevice={changeMicDevice} audioMetrics={audioMetrics}
        onSelect={selectTextModel} audioModelId={audioModelId} onAudioModel={selectAudioModel} onAction={handleSettingsAction}
        busy={loading || generating || searchingWeb || isRecordingMic || isCapturingTabAudio || whisperLoading || !!asrBusyText} />

      <header inert={!startupReady || loading || !!requestedModelId} className="app-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setShowSidebar(true)} title={tr("Vos conversations")} aria-label={tr("Vos conversations")} className="header-icon"><Menu size={19} strokeWidth={1.6} /></button>
          <div className="localai-brand" aria-label="Locaya">
            <svg viewBox="0 0 28 28" width="25" height="25" fill="none" aria-hidden="true"><path d="M6 7v10a5 5 0 0 0 5 5h10M12 5v9a3 3 0 0 0 3 3h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><circle cx="22" cy="7" r="2.5" fill="currentColor" /></svg>
            <span>Locaya</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && <button type="button" onClick={startNewChat} disabled={generating || searchingWeb} title={tr("Nouvelle conversation")} aria-label={tr("Nouvelle conversation")} className="header-icon"><Plus size={19} /></button>}
          <button type="button" onClick={() => setDark((value) => !value)} title={dark ? tr("Passer en mode clair") : tr("Passer en mode sombre")} aria-label={dark ? tr("Passer en mode clair") : tr("Passer en mode sombre")} className="header-icon">{dark ? <Sun size={18} strokeWidth={1.6} /> : <Moon size={18} strokeWidth={1.6} />}</button>
        </div>
      </header>

      <ModelSetupDialog open={!showSettings && (!startupReady || !!requestedModelId || loading)} checking={!cacheChecked}
        busy={loading} progress={progress} phase={loadPhase} name={setupSpec.name} size={setupSpec.sizeLabel}
        cached={!!cachedMap[setupSpec.id]} error={errorMsg} unavailable={!webgpuAvailable} optional={startupReady}
        onDownload={() => downloadModel(setupSpec.id)}
        onImport={setupSpec.isVision ? undefined : importOwnModel}
        onSettings={() => setShowSettings(true)} isVision={setupSpec.isVision}
        choices={catalogModels} selectedId={setupSpec.id} recommendedId={recommendedModelId} onChoose={selectTextModel}
        onCancel={() => { pendingModelActionRef.current = null; setRequestedModelId(null); setErrorMsg(null) }} />

      {/* Bandeau d'écoute audio en direct */}
      {isCapturingTabAudio && (
        <div className="px-3.5 py-2 bg-rose-600 text-white text-xs flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
            <span className="font-medium truncate">{tr('Écoute de l’onglet')} ({formatDuration(tabAudioSeconds)})</span>
          </div>
          <button
            type="button"
            onClick={handleStopTabAudioAndSummarize}
            className="cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-rose-700 font-bold text-[11px] hover:bg-rose-50 shrink-0 shadow-xs"
          >
            <Square size={10} fill="currentColor" /> {tr('Terminer et résumer')}
          </button>
        </div>
      )}

      {/* ─── Zone Centrale (Accueil ou Conversation) ─── */}
      <main inert={!startupReady || loading || !!requestedModelId} className="chat-scroll">
        {/* Écran d'accueil épuré et chaleureux */}
        {messages.length === 0 && !searchingWeb && (
          <div className="welcome">
            <div className="welcome-heading">
              <div className="welcome-symbol">
                <Sparkles size={30} strokeWidth={1.2} />
              </div>
              <h1 className="text-[23px] font-medium tracking-tight">{tr("Prêt quand vous voulez.")}</h1>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 max-w-[290px] mx-auto leading-relaxed">
                {tr("Une question, une idée, un document.")}</p>

              {!webgpuAvailable && (
                <div
                  className={`mt-3 flex items-start gap-2 text-left text-xs p-3 rounded-2xl border ${
                    dark
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>
                    {tr('L’accélération graphique (WebGPU) est désactivée. Activez-la dans les paramètres de Chrome.')}
                  </span>
                </div>
              )}

            </div>

            {/* Quelques idées avant de commencer */}
            <div className="welcome-actions">
              <button
                type="button"
                onClick={() => handleSummarizeActivePage()}
                disabled={loading || generating}
                className={`group cursor-pointer flex items-center gap-3 text-left px-3 py-2.5 rounded-xl transition-colors ${
                  dark
                    ? 'text-slate-300 hover:bg-white/5'
                    : 'text-slate-700 hover:bg-slate-100/80'
                }`}
              >
                <Globe size={16} className="shrink-0 text-slate-500" />
                <span className="text-[13px] font-medium">{tr("Résumer cette page")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleCaptureTabToAttachments(false)}
                disabled={loading || generating}
                className={`group cursor-pointer flex items-center gap-3 text-left px-3 py-2.5 rounded-xl transition-colors ${
                  dark
                    ? 'text-slate-300 hover:bg-white/5'
                    : 'text-slate-700 hover:bg-slate-100/80'
                }`}
              >
                <Camera size={16} className="shrink-0 text-slate-500" />
                <span className="text-[13px] font-medium">{tr("Analyser l'écran")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleTabAudioAction()}
                disabled={loading || generating}
                className={`group cursor-pointer flex items-center gap-3 text-left px-3 py-2.5 rounded-xl transition-colors ${
                  dark
                    ? 'text-slate-300 hover:bg-white/5'
                    : 'text-slate-700 hover:bg-slate-100/80'
                }`}
              >
                <Headphones size={16} className="shrink-0 text-slate-500" />
                <span className="text-[13px] font-medium">{tr("Résumer une vidéo ou un audio")}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || generating}
                className={`group cursor-pointer flex items-center gap-3 text-left px-3 py-2.5 rounded-xl transition-colors ${
                  dark
                    ? 'text-slate-300 hover:bg-white/5'
                    : 'text-slate-700 hover:bg-slate-100/80'
                }`}
              >
                <FileText size={16} className="shrink-0 text-slate-500" />
                <span className="text-[13px] font-medium">{tr("Ajouter un fichier")}</span>
              </button>
            </div>

          </div>
        )}

        {/* ─── Fil de discussion ─── */}
        {messages.map((msg, idx) => {
          if (!generating && idx === messages.length - 1 && msg.role === 'assistant' && msg.content === '') {
            return null
          }

          let hasThink = false
          let thinkContent = ''
          let isClosed = false
          let restContent = textOf(msg.content)

          if (msg.role === 'assistant' && typeof msg.content === 'string') {
            const thinkMatch = msg.content.match(/<think>([\s\S]*?)(?:<\/think>|$)/)
            if (thinkMatch) {
              hasThink = thinkMatch[1].trim().length > 0 || !msg.content.includes('</think>')
              thinkContent = thinkMatch[1].trim()
              isClosed = msg.content.includes('</think>')
              restContent = msg.content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim()
            }
          }

          // Sources Web et outil automatique associés au tour de réponse
          const prevUserMsg = idx > 0 && messages[idx - 1]?.role === 'user' ? messages[idx - 1] : null
          const assistantSources = msg.role === 'assistant' && !msg.failed && !/^Erreur\s*:/i.test(restContent)
            ? getCitedSources(restContent, prevUserMsg?.webSources) : []
          const markdownContent = msg.role === 'assistant' ? formatCitations(restContent, assistantSources) : restContent
          const isLatestAssistant = idx === messages.findLastIndex((message) => message.role === 'assistant')
          const isResponding = generating && idx === messages.length - 1

          return (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              key={idx}
              className={`message-turn group flex flex-col ${msg.role === 'user' ? 'user-turn items-end' : 'assistant-turn items-start'}`}
            >
              <div
                className={`${msg.role === 'user' ? 'user-message' : 'assistant-message'} max-w-[92%] rounded-2xl ${
                  msg.role === 'user'
                    ? `${dark ? 'bg-[#303030] text-white' : 'bg-slate-200 text-slate-900'} px-4 py-2.5 rounded-2xl rounded-br-md shadow-xs`
                    : 'bg-transparent pr-1 py-1'
                }`}
              >
                {/* Pièces jointes de l'utilisateur */}
                {msg.attachedFiles && msg.attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {msg.attachedFiles.map((att, i) => (
                      <div key={i}>
                        {att.type === 'image' ? (
                          <img
                            src={att.content}
                            alt={att.fileName}
                            className="max-w-52 max-h-44 rounded-xl object-contain border border-white/20"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-white/15 text-white font-medium">
                            <FileText size={12} />
                            <span className="truncate max-w-44">{att.fileName}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Bloc de réflexion discret et repliable */}
                {isResponding && !hasThink && !restContent && (
                  <div className="response-status" role="status"><span className="thinking-active">{msg.thinking ? tr("Réflexion en cours…") : tr("Préparation de la réponse…")}</span></div>
                )}
                {hasThink && (
                  <details className="thinking-details">
                    <summary className={!isClosed && isResponding ? 'thinking-active' : undefined}>
                      {!isClosed && isResponding ? tr("Réflexion en cours…") : tr("Réflexion")}
                    </summary>
                    <div
                      className={`mt-1.5 pl-3 border-l-2 text-xs whitespace-pre-wrap leading-relaxed ${
                        dark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      {thinkContent}
                    </div>
                  </details>
                )}

                {/* Texte du message */}
                {restContent && (
                  <div
                    className={`text-[13.5px] leading-relaxed break-words space-y-2.5 ${
                      msg.role === 'user' ? '' : 'markdown-body'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{restContent}</p>
                    ) : (
                      <ReactMarkdown
                        components={{
                          code: CodeBlock,
                          p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-5 mb-2.5 space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2.5 space-y-1">{children}</ol>,
                          li: ({ children }) => <li>{children}</li>,
                          h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-3">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-xs font-bold mb-1 mt-2">{children}</h3>,
                          a: ({ href, children }) => {
                            const citationSource = assistantSources?.find((source) => source.url === href)
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                title={citationSource ? `${citationSource.title} — ${citationSource.domain}` : undefined}
                                aria-label={citationSource ? `Source ${citationSource.index} : ${citationSource.title}` : undefined}
                                className={citationSource
                                  ? 'inline-citation'
                                  : 'text-indigo-500 underline underline-offset-2 hover:text-indigo-400'}
                              >
                                {children}
                              </a>
                            )
                          },
                          blockquote: ({ children }) => (
                            <blockquote
                              className={`border-l-3 border-indigo-500 pl-3 py-1 italic my-2 rounded-r-lg ${
                                dark ? 'bg-slate-800/50 text-slate-300' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {children}
                            </blockquote>
                          ),
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        }}
                      >
                        {markdownContent}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="message-actions user-actions">
                  <MessageTime value={msg.sentAt} />
                  <button type="button" onClick={() => rollbackAndEdit(idx)} disabled={generating || loading || searchingWeb} title={tr("Modifier la question")} aria-label={tr("Modifier la question")}><RotateCcw size={14} strokeWidth={1.6} /></button>
                  <button type="button" onClick={() => void copyMessage(idx, restContent)} title={copiedMessageIdx === idx ? tr("Copié") : tr("Copier le message")} aria-label={copiedMessageIdx === idx ? tr("Message copié") : tr("Copier le message")}>{copiedMessageIdx === idx ? <CheckCircle2 size={15} /> : <Copy size={15} strokeWidth={1.6} />}</button>
                </div>
              )}

              {msg.role === 'assistant' && restContent && (
                <div className={`message-actions assistant-actions ${isLatestAssistant || speakingIdx === idx ? '' : 'hover-actions'}`}>
                  {msg.metrics && <ResponseStats metrics={msg.metrics} />}
                  <button type="button" onClick={() => void copyMessage(idx, markdownContent)} title={copiedMessageIdx === idx ? tr("Copié") : tr("Copier la réponse")} aria-label={copiedMessageIdx === idx ? tr("Réponse copiée") : tr("Copier la réponse")}>{copiedMessageIdx === idx ? <CheckCircle2 size={15} /> : <Copy size={15} strokeWidth={1.6} />}</button>
                  <button type="button" onClick={() => handleSpeakMessage(idx, restContent)} title={speakingIdx === idx ? tr("Arrêter la lecture") : tr("Écouter la réponse")} aria-label={speakingIdx === idx ? tr("Arrêter la lecture") : tr("Écouter la réponse")} aria-pressed={speakingIdx === idx}>{speakingIdx === idx ? <Square size={12} fill="currentColor" /> : <Volume2 size={16} strokeWidth={1.6} />}</button>
                  <MessageTime value={msg.sentAt} />
                </div>
              )}
              {msg.role === 'assistant' && !isResponding && !!prevUserMsg?.researchSteps?.length && (
                <details className="research-details">
                  <summary>{tr('Détails de la recherche web')}</summary>
                  <ul>{prevUserMsg.researchSteps.map((step, index) => <li key={index}>{tr(step)}</li>)}</ul>
                </details>
              )}
            </motion.div>
          )
        })}

        {searchingWeb && (
          <div className="research-turn">
            {textOf([...messages].reverse().find((message) => message.role === 'user')?.content ?? '') !== webResearch.query && (
              <div className="message-turn user-turn flex flex-col items-end"><p className="user-message whitespace-pre-wrap text-sm">{webResearch.query}</p><div className="message-actions user-actions"><MessageTime value={webResearch.sentAt} /></div></div>
            )}
            <div className="response-status" role="status"><span className="thinking-active">{tr("Recherche en cours…")}</span></div>
          </div>
        )}
        {!searchingWeb && (pdfExtractionStatus || statusBanner) && (
          <div className="inline-activity" role="status">
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span>{pdfExtractionStatus || tr("Préparation de la réponse…")}</span>
          </div>
        )}


        {errorMsg && (
          <div
            className={`flex items-start justify-between gap-2 text-xs p-3 rounded-2xl border ${
              dark
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="cursor-pointer opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* ─── Zone de Saisie Flottante Unifiée ("Omnibox") ─── */}
      <footer inert={!startupReady || loading || !!requestedModelId} className="composer-footer relative z-20">
        {/* Suggestions contextuelles intelligentes (s'affichent uniquement quand une image ou un document est joint) */}
        <AnimatePresence>
          {(hasImageAttachment || hasDocAttachments) && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="flex flex-wrap gap-1.5 mb-2"
            >
              {hasImageAttachment && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      handleCaptureAndRunVisionPrompt(
                        "Explique en détail ce graphique ou le contenu visuel de cette capture d'écran.",
                        tr("📊 Expliquer ce graphique"),
                      )
                    }
                    disabled={loading || generating}
                    className={`cursor-pointer px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      dark
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    {tr("📊 Expliquer ce graphique")}</button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCaptureAndRunVisionPrompt(
                        'Extrais et traduis en français tout le texte visible sur cette image.',
                        tr("🌍 Traduire l'écran"),
                      )
                    }
                    disabled={loading || generating}
                    className={`cursor-pointer px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      dark
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    {tr("🌍 Traduire en français")}</button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCaptureAndRunVisionPrompt(
                        "Analyse cette interface web : identifie les problèmes d'affichage, d'UX/UI ou les erreurs visibles et propose des correctifs.",
                        tr("🛠️ Analyser l'interface"),
                      )
                    }
                    disabled={loading || generating}
                    className={`cursor-pointer px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      dark
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    {tr("🛠️ Débugger l'interface")}</button>
                </>
              )}

              {hasDocAttachments && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      runPromptImmediately(
                        'Fais une synthèse structurée complète de ce document : points clés, sections principales et conclusions.',
                        attachments,
                        undefined,
                        tr("📑 Résumer le document"),
                      )
                    }
                    disabled={loading || generating}
                    className={`cursor-pointer px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      dark
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {tr("📑 Résumer le document")}</button>
                  <button
                    type="button"
                    onClick={() =>
                      runPromptImmediately(
                        'Analyse ce fichier en profondeur : identifie les points critiques, erreurs potentielles et améliorations possibles.',
                        attachments,
                        undefined,
                        tr("🔍 Analyser en profondeur"),
                      )
                    }
                    disabled={loading || generating}
                    className={`cursor-pointer px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      dark
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {tr("🔍 Analyser en profondeur")}</button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Carte Omnibox Flottante */}
        <form
          onSubmit={sendMessage}
          className={`composer relative rounded-[26px] border transition-all duration-200 px-3 py-2.5 shadow-sm ${
            dark
              ? 'bg-[#212121] border-white/5 focus-within:border-white/15 shadow-black/20'
              : 'bg-white border-slate-200/80 focus-within:border-slate-300 shadow-slate-200/50'
          }`}
        >
          {isRecordingMic && <DictationVisualizer recorder={micRecorderRef.current} />}
          {(showWhisperSetup || asrBusyText || whisperError) && !isRecordingMic && (
            <div className="composer-model-status">
              <div className="composer-model-row">
                {asrBusyText ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
                <span role={whisperError ? 'alert' : 'status'}>{whisperError || asrBusyText || (isRecordingMic ? tr("Dictée en cours…") : whisperCached ? tr("Le modèle de dictée est disponible sur cet appareil.") : tr("Modèle pour la dictée vocale"))}</span>
                <button type="button" aria-label={whisperLoading || asrBusyText ? tr('Annuler le traitement audio') : tr('Fermer les informations de dictée')} onClick={() => { if (whisperLoading || asrBusyText) cancelAudioTask(); else { pendingDictationRef.current = false; setShowWhisperSetup(false); setWhisperError(null) } }}><X size={14} /></button>
              </div>
              {whisperLoading && <div className="composer-model-progress" role="progressbar" aria-label={tr('Chargement du modèle de dictée')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(whisperProgress * 100)}><span style={{ width: `${Math.round(whisperProgress * 100)}%` }} /></div>}
              {whisperLoading && <span className="composer-model-percent">{Math.round(whisperProgress * 100)} %</span>}
              {!whisperReady && !whisperLoading && !asrBusyText && <button type="button" className="composer-download" onClick={prepareWhisper} disabled={whisperCached === null}><Download size={14} />{whisperCached === null ? tr("Vérification…") : whisperCached ? tr("Charger le modèle") : tr("Télécharger le modèle de dictée")}</button>}
            </div>
          )}
          {hasImageAttachment && !cachedMap[VISION_MODEL_ID] && <div className="composer-model-status"><button type="button" className="composer-download" onClick={() => requireModel(VISION_MODEL_ID)}><Download size={14} />{tr("Télécharger le modèle d’images")}</button></div>}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            multiple
            accept={ACCEPTED_FILE_EXTENSIONS}
          />

          {/* Aperçu des pièces jointes à l'intérieur de la carte */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-2 mb-1.5 border-b border-slate-200/60 dark:border-slate-800">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className={`flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-xl text-[11px] border ${
                    dark
                      ? 'bg-slate-800/90 border-slate-700 text-slate-200'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  {att.type === 'image' ? (
                    <img src={att.content} alt={att.fileName} className="w-5 h-5 object-cover rounded-md" />
                  ) : (
                    <FileText size={12} className="text-indigo-500 shrink-0" />
                  )}
                  <span className="truncate max-w-36 font-medium">
                    {att.fileName}
                    {att.pageCount ? ` (${att.pageCount}p)` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                    className="p-0.5 rounded-full text-slate-400 hover:text-red-500 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Champ de saisie */}
          <textarea
            ref={composerInputRef}
            rows={1}
            aria-label={tr("Votre message")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!generating && (input.trim() || attachments.length > 0)) event.currentTarget.form?.requestSubmit()
              }
            }}
            disabled={loading || generating || searchingWeb || !webgpuAvailable}
            placeholder={
              loading ? tr("Préparation de l'assistant…") : tr("Demander à Locaya")
            }
            className="w-full bg-transparent px-1.5 py-1.5 text-[14px] focus:outline-none disabled:opacity-50 placeholder:text-slate-400"
          />

          <div className="composer-toolbar flex items-center justify-between gap-2 pt-2 mt-1">
            <div className="relative" ref={toolsMenuRef}>
              <button
                type="button"
                onClick={() => setShowToolsMenu((open) => !open)}
                aria-label={tr("Afficher les outils")}
                aria-expanded={showToolsMenu}
                title={tr("Ajouter ou utiliser un outil")}
                className={`cursor-pointer grid h-9 w-9 place-items-center rounded-full transition-colors ${dark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {showToolsMenu ? <X size={19} /> : <Plus size={20} />}
              </button>
              <AnimatePresence>
                {showToolsMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    className={`tools-popover absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-2xl border p-1.5 shadow-2xl ${dark ? 'border-white/10 bg-[#202124] text-slate-100 shadow-black/50' : 'border-slate-200 bg-white text-slate-800 shadow-slate-900/15'}`}
                    role="group"
                    aria-label={tr("Outils de conversation")}
                  >
                    <button type="button" disabled={loading || generating} onClick={() => { setShowToolsMenu(false); fileInputRef.current?.click() }} className="tool-menu-item"><Paperclip size={17} /><span>{tr("Ajouter un fichier ou une image")}</span></button>
                    <button type="button" disabled={loading || generating} onClick={() => { setShowToolsMenu(false); void handleSummarizeActivePage() }} className="tool-menu-item"><Globe size={17} /><span>{tr("Résumer la page ouverte")}</span></button>
                    <button type="button" disabled={loading || generating} onClick={() => { setShowToolsMenu(false); void handleCaptureTabToAttachments(false) }} className="tool-menu-item"><Camera size={17} /><span>{tr("Analyser l'écran")}</span></button>
                    <button type="button" disabled={loading || generating} onClick={() => { setShowToolsMenu(false); void handleTabAudioAction() }} className="tool-menu-item"><Headphones size={17} /><span>{tr("Écouter ou résumer l'audio")}</span></button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {getModelSpec(textModelId).supportsThinking !== false && <div className="thinking-switch" role="group" aria-label={tr("Mode de réponse")}>
              <button type="button" aria-pressed={!thinkingEnabled} disabled={loading || generating || searchingWeb}
                onClick={() => setThinkingEnabled(false)} title={tr("Réponse directe")}><Zap size={14} /><span>{tr("Rapide")}</span></button>
              <button type="button" aria-pressed={thinkingEnabled} disabled={loading || generating || searchingWeb}
                onClick={() => setThinkingEnabled(true)} title={tr("Réflexion native du modèle pour les demandes texte")}><Brain size={14} /><span>{tr("Thinking")}</span></button>
            </div>}
            <div className="composer-actions flex items-center gap-1.5">
              <button type="button" onClick={handleToggleMicDictation} disabled={!isRecordingMic && (!startupReady || loading || generating || searchingWeb || !!asrBusyText)} title={isRecordingMic ? tr("Arrêter la dictée") : whisperReady || whisperCached ? tr("Dicter à la voix") : tr("Télécharger le modèle de dictée")} aria-label={isRecordingMic ? tr("Arrêter la dictée vocale") : whisperReady || whisperCached ? tr("Dicter à la voix") : tr("Télécharger le modèle de dictée")} className={`relative grid h-9 w-9 place-items-center rounded-full transition-all disabled:opacity-40 ${isRecordingMic ? 'bg-rose-500 text-white' : dark ? 'text-slate-200 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}><Mic size={17} />{!whisperCached && !whisperReady && <Download size={10} className="mic-download-badge" />}</button>
              {generating ? (
                <button type="button" onClick={stopGeneration} title={tr("Arrêter la réponse")} aria-label={tr("Arrêter la réponse")} className="grid h-9 w-9 place-items-center rounded-full bg-rose-500 text-white"><Square size={13} fill="currentColor" /></button>
              ) : searchingWeb ? (
                <button type="button" disabled aria-label={tr('Recherche en cours…')} className="grid h-9 w-9 place-items-center rounded-full"><Loader2 size={18} className="animate-spin" /></button>
              ) : (
                <button type="submit" disabled={!startupReady || loading || isRecordingMic || !!asrBusyText || !webgpuAvailable || (!input.trim() && attachments.length === 0)} title={tr("Envoyer")} aria-label={tr("Envoyer le message")} className="primary-action grid h-9 w-9 place-items-center rounded-full"><ArrowUp size={19} strokeWidth={2.5} /></button>
              )}
            </div>
          </div>
        </form>
      </footer>

    </div>
  )
}
