import { defineConfig } from 'vite'
import { createReadStream, statSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

// This optional endpoint serves one explicitly selected GGUF, never a directory.
// It is only available on the loopback development server, outside the extension.
const modelPath = process.env.LOCALAI_GGUF
export default defineConfig({
  plugins: [react(), {
    name: 'local-gguf-test',
    configureServer(server) {
      server.middlewares.use('/test-model.gguf', (req, res) => {
        if (!modelPath || req.method !== 'GET') {
          res.statusCode = 404
          res.end('Définissez LOCALAI_GGUF avant de démarrer le test.')
          return
        }
        try {
          const path = resolve(modelPath)
          const size = statSync(path).size
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', size)
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
          createReadStream(path).on('error', () => res.destroy()).pipe(res)
        } catch {
          res.statusCode = 404
          res.end('Fichier GGUF introuvable.')
        }
      })
    },
  }],
  server: {
    host: '127.0.0.1', port: 4174, strictPort: true, hmr: false,
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
  worker: { format: 'es' },
})
