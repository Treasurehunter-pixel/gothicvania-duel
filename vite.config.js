import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this repo at /gothicvania-duel/, not the domain root,
// so every asset URL Vite generates needs that prefix baked in at build time.
export default defineConfig({
  base: '/gothicvania-duel/',
  plugins: [react()],
})
