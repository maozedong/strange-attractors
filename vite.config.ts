import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH=/strange-attractors/next/ for the preview on GitHub Pages; the default serves from the root.
// NO_HMR=1 turns hot reloading off, for when several people (or agents) edit while pages are open.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { hmr: process.env.NO_HMR ? false : undefined },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
