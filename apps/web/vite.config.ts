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
    // The largest chunk is React DOM (~220 kB); anything bigger means a split regressed.
    chunkSizeWarningLimit: 250,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Libraries every page needs get their own long-lived chunks, so app changes don't
          // invalidate them in browsers' caches. MUI is left to split per page: grouping it would
          // pull build-page-only components into the first load.
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
})
