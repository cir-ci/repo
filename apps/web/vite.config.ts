import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { circiTokensCss } from '../../packages/ui/tokens-css.ts'

// `pnpm dev` here proxies the API to a CirCI server on :3000 (pnpm circi all).
export default defineConfig({
  plugins: [circiTokensCss(), react()],
  resolve: {
    // `vite build` picks the `production` condition and would resolve @circi/ui to its dist (JS
    // without the compiled styles: the web CSS shrinks from 55 kB to 21 kB). Pin the source so dev
    // and build are the same and Vite compiles the CSS modules.
    alias: {
      '@circi/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
    },
  },
  // @circi/ui's CSS modules are compiled here (the `development` condition resolves its source).
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The largest chunk is React DOM (~220 kB); anything bigger means a split regressed.
    chunkSizeWarningLimit: 250,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Libraries every page needs get their own long-lived chunks, so app changes don't
          // invalidate them in browsers' caches. Everything else splits per page.
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
})
