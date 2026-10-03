import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH lets the same build serve from a sub-path (GitHub Pages: /strange-attractors/)
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
})
