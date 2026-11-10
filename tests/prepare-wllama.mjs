import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The published npm 3.8.1 embeds b11364, which cannot load LFM3.
// Pair the official 3.12.0 source and WASM, pinned to immutable revisions.
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(root, '.local/wllama-evaluation')
const sourceCommit = 'a24b3564dd3c108af85a79a2c3b08a88bd2e7370'
const sourceRoot = join(destination, 'source', `wllama-${sourceCommit}`)
const sourceHash = '95a5f86dab27480ef1a69aa243691694ea0b2b78e18819cdfd224bfff4baeda6'
const wasmHash = '69c583b0ee85fb940a8956951abe5e5be352f9e26afc2b80cdde881f86de4660'
const spaceRevision = 'b4aab287485d231cca6896e614e24362436f49a1'

await mkdir(destination, { recursive: true })
async function verifiedDownload(url, name, expected) {
  const path = join(destination, name)
  let data
  try { data = await readFile(path) } catch { /* First preparation. */ }
  if (!data || createHash('sha256').update(data).digest('hex') !== expected) {
    console.log(`Préparation du moteur : ${name}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} pendant le téléchargement de ${name}`)
    data = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(data).digest('hex') !== expected) {
      throw new Error(`Empreinte de ${name} inattendue. Le fichier n’a pas été installé.`)
    }
    await writeFile(path, data)
  }
  return path
}
const archive = await verifiedDownload(`https://github.com/ngxson/wllama/archive/${sourceCommit}.zip`, 'source.zip', sourceHash)
await verifiedDownload(`https://huggingface.co/spaces/ngxson/wllama/resolve/${spaceRevision}/assets/wllama-DyBPDcIZ.wasm`, 'wllama.wasm', wasmHash)
try { await access(join(sourceRoot, 'src/index.ts')) }
catch {
  const quote = value => `'${value.replaceAll("'", "''")}'`
  const extraction = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(join(destination, 'source'))} -Force`], { stdio: 'inherit' })
    : spawnSync('unzip', ['-q', archive, '-d', join(destination, 'source')], { stdio: 'inherit' })
  if (extraction.status !== 0) throw new Error('Impossible de décompresser la source officielle de wllama.')
}
const generated = await readFile(join(sourceRoot, 'src/workers-code/generated.ts'), 'utf8')
if (!generated.includes("LIBLLAMA_VERSION = 'b12162-d38bea3'")) throw new Error('Version JavaScript/WASM inattendue.')
console.log('wllama 3.12.0 · llama.cpp b12162-d38bea3 · fichiers officiels vérifiés et prêts.')
