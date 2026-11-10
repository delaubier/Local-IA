import { spawn } from 'node:child_process'
import { mkdir, appendFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

// Temporary runtime trace, excluded from Git. Stop automatically after 3 minutes.
const directory = resolve('.local/lmstudio-export')
await mkdir(directory, { recursive: true })
const path = join(directory, 'runtime-trace.jsonl')
await writeFile(path, '')
const lms = join(homedir(), '.lmstudio/bin/lms.exe')
const child = spawn(lms, ['log', 'stream', '--source', 'runtime', '--json'], { windowsHide: true })
let bytes = 0
child.stdout.on('data', data => { bytes += data.length; void appendFile(path, data) })
child.stderr.on('data', data => process.stderr.write(data))
console.log('Capture du moteur en cours, fichier temporaire : ' + path)
const stop = () => child.kill()
const timer = setTimeout(stop, 180_000)
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', code => { clearTimeout(timer); console.log(`Capture terminée : ${bytes} octets, code ${code}.`); process.exitCode = 0 })
