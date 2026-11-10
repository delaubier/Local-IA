import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import './prepare-wllama.mjs'

// A file picker is also available: setting this variable is optional.
const defaultModel = resolve(homedir(), '.lmstudio/models/LiquidAI/LFM3-1.7B-GGUF/LFM3-1.7B-Q8_0.gguf')
if (!process.env.LOCALAI_GGUF && existsSync(defaultModel)) process.env.LOCALAI_GGUF = defaultModel
const server = await createServer({ configFile: 'tests/wllama.vite.config.ts' })
await server.listen()
console.log('\nOuvrez http://127.0.0.1:4174/tests/wllama-evaluation.html\n')
server.printUrls()
const stop = async () => { await server.close(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
