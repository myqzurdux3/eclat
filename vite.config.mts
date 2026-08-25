import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
})
