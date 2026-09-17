import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this repo at /gothicvania-duel/, not the domain root,
// so every asset URL Vite generates needs that prefix baked in at build
// time — but Vercel serves the same build at its own domain's root, where
// that same prefix would 404 every asset. Vercel sets VERCEL=1 during its
// own build, which is what tells the two apart.
export default defineConfig({
  base: process.env.VERCEL ? '/' : '/gothicvania-duel/',
  plugins: [react()],
})
