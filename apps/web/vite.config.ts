import { fileURLToPath } from 'node:url'

import { circiTokensCss } from '@circi/ui/tokens-css'
import react from '@vitejs/plugin-react'
import { build, defineConfig, type Plugin } from 'vite'

// The dev server proxies everything that isn't the dashboard to a CirCI server: :3000 (pnpm circi
// all), or the one `pnpm dev` at the repository root starts (CIRCI_DEV_API_URL). Not only `/api`:
// with local-disk storage, CI uploads go to PUBLIC_URL/v1/files, and PUBLIC_URL is this server.
const api = process.env.CIRCI_DEV_API_URL ?? 'http://localhost:3000'
const serverPaths = ['/api', '/v1', '/v2', '/webhooks', '/healthz', '/readyz', '/internal']
/**
 * Builds the service worker (`src/sw/sw.ts`) as `dist/sw.js`: a classic script at the root, so
 * its scope is the whole app, with a stable name (the browser checks that exact file for a new
 * version) and none of the page's chunks. Not run in `vite dev`, where the app registers none.
 */
function serviceWorker(): Plugin {
  return {
    name: 'circi-service-worker',
    apply: 'build',
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        build: {
          outDir: fileURLToPath(new URL('dist', import.meta.url)),
          emptyOutDir: false,
          copyPublicDir: false,
          rolldownOptions: {
            input: fileURLToPath(new URL('src/sw/sw.ts', import.meta.url)),
            output: { format: 'iife', entryFileNames: 'sw.js', codeSplitting: false },
          },
        },
      })
    },
  }
}

export default defineConfig({
  plugins: [circiTokensCss(), react(), serviceWorker()],
  resolve: {
    // `vite build` picks the `production` condition and would resolve @circi/ui to its dist (JS
    // without the compiled styles: the web CSS shrinks from 55 kB to 21 kB). Pin the source so dev
    // and build are the same and Vite compiles the CSS modules.
    // An exact match: `@circi/ui/utilities.module.css` (composed by the CSS modules) resolves
    // through the package's `exports`.
    alias: [
      {
        find: /^@circi\/ui$/,
        replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
      },
    ],
  },
  // @circi/ui's CSS modules are compiled here (the `@circi/source` condition resolves its source).
  server: {
    proxy: Object.fromEntries(serverPaths.map((path) => [path, api])),
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
