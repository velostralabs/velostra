import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js is isolated in a lazy async chunk; gzip budgets are enforced separately.
    chunkSizeWarningLimit: 1000,
  },
})
