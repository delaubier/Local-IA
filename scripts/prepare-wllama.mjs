import '../tests/prepare-wllama.mjs'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { build, transform } from 'esbuild'

// Chrome MV3: all executable code, including both worker levels, is packaged.
// No blob workers, remote compatibility scripts, eval, or relaxed script CSP.
const root = fileURLToPath(new URL('../', import.meta.url))
const prepared = resolve(root, '.local/wllama-evaluation')
const upstream = join(prepared, 'source/wllama-a24b3564dd3c108af85a79a2c3b08a88bd2e7370')
const out = resolve(root, 'public/wllama')
const generated = resolve(root, 'src/vendor/generated')
await mkdir(out, { recursive: true })
await mkdir(generated, { recursive: true })
const { code } = await transform(await readFile(join(upstream, 'src/workers-code/generated.ts'), 'utf8'), { loader: 'ts', format: 'esm' })
const { WLLAMA_EMSCRIPTEN_CODE, LLAMA_CPP_WORKER_CODE } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const original = await readFile(join(upstream, 'src/worker.ts'), 'utf8')
const start = original.indexOf('    let moduleCode = JSPI_STUB')
const end = original.indexOf('    // allocate all files', start)
if (start < 0 || end < 0) throw new Error('La structure du worker wllama a changé ; adaptation MV3 à vérifier.')
const worker = original.slice(0, start) + `
    const runOptions = {
      pathConfig: { 'wllama.wasm': this.resources.wasmPath },
      nbThread: this.nbThread, compat: false, noWebGPU: this.resources.noWebGPU,
    };
    this.worker = new Worker(new URL('native-worker.js', this.resources.wasmPath).href, { type: 'module' });
    this.worker.onmessage = this.onRecvMsg.bind(this);
    this.worker.onerror = (event) => this.abort(event.message || 'Native worker failed', '');
    const res = await this.pushTask({ verb: 'module.init', args: [
      new URL('pthread.js', this.resources.wasmPath).href, this.useAsyncFile, runOptions,
    ], callbackId: this.taskId++ });
` + original.slice(end)
await build({ entryPoints: [join(upstream, 'src/index.ts')], bundle: true, format: 'esm', platform: 'browser',
  outfile: join(generated, 'wllama.js'), plugins: [{ name: 'chrome-mv3-worker', setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/]worker\.ts$/ }, () => ({ contents: worker, loader: 'ts', resolveDir: join(upstream, 'src') }))
    builder.onLoad({ filter: /[\\/]src[\\/]wllama\.ts$/ }, async ({ path }) => ({
      contents: (await readFile(path, 'utf8'))
        .replace("import { WasmCompatFromCDN } from './wasm-from-cdn';", '')
        .replace("this.setCompat('default');", 'this.setCompat(null);')
        .replace("this.compat = compat === 'default' ? WasmCompatFromCDN : compat;", "this.compat = compat === 'default' ? null : compat;"),
      loader: 'ts', resolveDir: join(upstream, 'src'),
    }))
  } }],
})
const stub = `if (!WebAssembly.Suspending) { WebAssembly.Suspending = function(fn){return fn;}; WebAssembly.promising = fn => (...args) => Promise.resolve(fn(...args)); }\n`
const native = LLAMA_CPP_WORKER_CODE.replace("  if (verb === 'module.init') {", "  if (verb === 'module.init') { RUN_OPTIONS = args[2];")
if (native === LLAMA_CPP_WORKER_CODE) throw new Error('Point d’initialisation du worker introuvable.')
const gpuGuard = `if(RUN_OPTIONS.noWebGPU){Object.defineProperty(WorkerNavigator.prototype,'gpu',{get:()=>({requestAdapter:async()=>null})});}`
await writeFile(join(out, 'native-worker.js'), `// wllama 3.12.0 · MIT · packaged MV3 worker\nlet RUN_OPTIONS;\n${stub}\nfunction wModuleInit(){${gpuGuard}\n${WLLAMA_EMSCRIPTEN_CODE.replace('var Module', 'var ___Module')}\nreturn Module;}\n${native}`)
await writeFile(join(out, 'pthread.js'), `// wllama 3.12.0 · MIT · packaged pthread worker\n${stub}${WLLAMA_EMSCRIPTEN_CODE}`)
await copyFile(join(prepared, 'wllama.wasm'), join(out, 'wllama.wasm'))
await copyFile(join(upstream, 'LICENCE'), join(out, 'LICENSE'))
console.log('wllama : moteur et workers MV3 regroupés localement.')
