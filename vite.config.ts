import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  worker: {
    format: 'es'
  },
  // Transformers.js / onnxruntime-web embarquent du WASM : on évite le pré-bundling esbuild
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web']
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 4096
  }
})
