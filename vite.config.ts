import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // maplibre-gl v6 es ESM puro y carga su Web Worker (que descarga y parsea
    // los tiles vectoriales) como módulo hermano resuelto en runtime. Si Vite
    // lo pre-empaqueta, el worker nunca arranca y los tiles vectoriales no se
    // piden (mapa en blanco sin errores). Ver maplibre-gl-js issue #7779.
    exclude: ['maplibre-gl'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
