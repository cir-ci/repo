import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `pnpm dev` here proxies the API to a CirCI server on :3000 (pnpm zopheros all / circi all).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // One internal dashboard bundle (~175 kB gzipped, mostly MUI); not worth splitting yet.
    chunkSizeWarningLimit: 700,
  },
})
