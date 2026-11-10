import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Read-only capture: no prediction, model load, preset change or server start.
const root = fileURLToPath(new URL('../', import.meta.url))
const sdkRoot = resolve(root, '.local/lmstudio-export/node_modules/@lmstudio/sdk')
const { LMStudioClient } = await import(pathToFileURL(join(sdkRoot, 'dist/index.mjs')).href)
const sdkPackage = JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8'))
const client = new LMStudioClient()
const loaded = await client.llm.listLoaded()
const info = loaded.find(item => item.identifier === 'lfm3-1.7b')
if (!info) throw new Error('LFM3 doit être déjà chargé dans LM Studio avant cet export.')
const model = await client.llm.model(info.identifier)
const [contextLength, loadConfig, basePredictionConfig] = await Promise.all([
  model.getContextLength(), model.getLoadConfig(), model.getBasePredictionConfig(),
])
const directory = join(homedir(), '.lmstudio')
const conversationConfig = JSON.parse(await readFile(join(directory, '.internal/conversation-config.json'), 'utf8'))
const name = conversationConfig.selectedConversation
if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) throw new Error('Nom de conversation inattendu.')
const chat = JSON.parse(await readFile(join(directory, 'conversations', name), 'utf8'))
const lastPrediction = [...(chat.messages ?? [])].reverse()
  .flatMap(message => [...(message.versions ?? [])].reverse())
  .flatMap(version => [...(version.steps ?? [])].reverse())
  .find(step => step.genInfo)?.genInfo ?? null
// Never export user messages, credentials or unrelated conversations.
const report = {
  capturedAt: new Date().toISOString(), sdkVersion: sdkPackage.version,
  captureMethod: 'Loaded model SDK configuration; no generation performed',
  model: info, contextLength, loadConfig, basePredictionConfig,
  selectedChat: {
    systemPrompt: chat.systemPrompt ?? '',
    perChatPredictionConfig: chat.perChatPredictionConfig ?? null,
    modelIdentifier: chat.lastUsedModel?.indexedModelIdentifier ?? null,
  },
  globalPredictionOverrides: conversationConfig.globalPredictionConfig ?? null,
  latestRecordedPrediction: lastPrediction,
  provenance: {
    sdkDefaultsFilled: true,
    explicitBaseKeys: basePredictionConfig.raw?.fields?.map(field => field.key) ?? [],
    samplingValuesConfirmedInRuntimeTrace: false,
    note: 'Sampling values supplied by the SDK for absent raw fields are schema defaults, not independently observed runtime sampler values.',
  },
  caveat: 'Base SDK defaults exclude per-request and GUI-chat overrides. Resolve the recorded chat overrides before comparing; raw model input/output was not captured.',
}
const out = resolve(root, 'docs/lmstudio-settings.json')
await mkdir(resolve(root, 'docs'), { recursive: true })
await writeFile(out, JSON.stringify(report, null, 2) + '\n')
const { temperature, topKSampling, topPSampling, minPSampling, repeatPenalty, reasoningBudget, maxTokens, enableThinking, contextOverflowPolicy } = basePredictionConfig
console.log(JSON.stringify({ file: out, contextLength,
  sdkBase: { temperature, topKSampling, topPSampling, minPSampling, repeatPenalty, reasoningBudget, maxTokens, enableThinking, contextOverflowPolicy },
  explicitBaseKeys: report.provenance.explicitBaseKeys, chatOverrides: report.selectedChat.perChatPredictionConfig,
}, null, 2))
process.exit(0)
