import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { circiTokensCss } from '@circi/ui/tokens-css'
import { CirciReporter } from '@circi/vitest'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { E2eTimingReporter } from './e2e/src/reporting/timing-reporter.ts'

const uiRequire = createRequire(resolve(import.meta.dirname, 'packages/ui/package.json'))

// Vite pre-bundles dependencies it finds while a browser project runs, and the first run after a
// new dependency can fail with import errors until it is rerun. Listing them up front makes
// that run optimise them before the first test: add a package here when a browser test starts
// importing it (the list of a run is in node_modules/.vite/vitest/*/deps/_metadata.json).
// Ids resolve from the project's root; `a > b` resolves b from where a is installed.
const reactDeps = ['react', 'react/jsx-dev-runtime', 'react/jsx-runtime', 'vitest-browser-react']
const baseUiDeps = [
  'alert-dialog',
  'autocomplete',
  'avatar',
  'button',
  'checkbox',
  'checkbox-group',
  'collapsible',
  'dialog',
  'drawer',
  'field',
  'fieldset',
  'input',
  'menu',
  'number-field',
  'popover',
  'scroll-area',
  'select',
  'slider',
  'switch',
  'toast',
  'toggle',
  'toggle-group',
  'tooltip',
].map((part) => `@base-ui/react/${part}`)
// Base UI and lucide are installed under @circi/ui; projects rooted elsewhere go through it.
const viaUi = (ids: string[]) => ids.map((id) => `@circi/ui > ${id}`)
// The team icons load from `lucide-react/dynamic.mjs` on demand: listed so a first run doesn't
// discover it mid-test and reload the page.
const iconDeps = ['boring-avatars', 'lucide-react', 'lucide-react/dynamic.mjs']
const uiOptimizeDeps = [...baseUiDeps, ...iconDeps, ...reactDeps]
const webOptimizeDeps = [
  ...viaUi([...baseUiDeps, ...iconDeps]),
  ...reactDeps,
  '@tanstack/react-query',
  '@tanstack/react-router',
  '@tanstack/react-virtual',
  'better-auth/client/plugins',
  'better-auth/react',
  'react-dom/client',
  'zustand',
  'zustand/middleware',
]
// The visual project is rooted at the repository (screenshots go to its .circi), where nothing
// but @circi/ui (a dependency of the root package) is installed.
const visualOptimizeDeps = viaUi([...baseUiDeps, ...iconDeps, 'react', 'react/jsx-dev-runtime'])

/**
 * Three kinds of test: logic (`*.test.ts`) runs in Node, including the web app's render-free tests;
 * end-to-end tests (`e2e`, Docker) run only on request;
 * components (`*.browser.test.tsx`) run in real headless Chromium through Vitest browser mode.
 */
export default defineConfig({
  // Fills the token variables into @circi/ui's global.css, as the real builds do.
  plugins: [circiTokensCss()],
  // Workspace packages that Vitest runs through Node itself (e.g. @circi/testing) need the condition too.
  ssr: { resolve: { externalConditions: ['node', '@circi/source'] } },
  resolve: {
    conditions: ['@circi/source'],
  },
  test: {
    testTimeout: 30_000,
    // `beforeAll(createTestDb)` under parallel workers is where the 10 s default used to time out.
    hookTimeout: 60_000,
    expect: { poll: { timeout: 5_000, interval: 50 } },
    // End-to-end runs also write e2e/.artifacts/timings.json and print a timing summary.
    // Visual runs (`pnpm test:visual`) send the screenshots to CirCI when CIRCI_API_URL and
    // CIRCI_TOKEN are set, and only keep them in .circi/screenshots otherwise.
    ...(process.env['E2E'] ? { reporters: ['default', new E2eTimingReporter()] } : {}),
    ...(process.env['VISUAL']
      ? { reporters: ['default', new CirciReporter({ name: 'ui-chromium', wait: true })] }
      : {}),
    // Stopping an end-to-end stack (docker compose down -v) happens in global teardown.
    teardownTimeout: 120_000,
    // `pnpm test:coverage` (Node project only: browser projects need their own provider setup).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/dist/**', 'packages/ui/**', 'packages/db/src/migrations/**'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          // One migrated PGlite dump for every createTestDb(), and TZ/mocks pinned per file.
          globalSetup: ['packages/db/src/testing/template-db.ts'],
          setupFiles: ['packages/testing/src/setup-node.ts'],
          include: [
            'apps/{server,worker,web}/test/**/*.test.ts',
            'packages/*/test/**/*.test.ts',
            // The e2e harness's own fakes: plain Node tests, no Docker.
            'e2e/test/fakes/**/*.test.ts',
          ],
        },
      },
      // End-to-end tests against the real Docker stack are registered only with E2E=1
      // (`pnpm test:e2e`), so a plain `vitest run` / `pnpm test` can never start Docker.
      // Two projects, by file name: `*.browser.e2e.test.ts` drives Chromium (Playwright, or the
      // dashboard through the CLI's host-side Vitest), every other `*.e2e.test.ts` only talks
      // HTTP, the CLI and the fakes. `pnpm test:e2e` runs both; `test:e2e:api` and
      // `test:e2e:browser` one each (the turbo tasks `//#e2e:api` and `//#e2e:browser`).
      // e2e/test/fakes/e2e-groups.test.ts keeps the names honest.
      ...(process.env['E2E']
        ? (['api', 'browser'] as const).map((group) => ({
            extends: true,
            test: {
              name: `e2e-${group}`,
              include: [
                group === 'browser'
                  ? 'e2e/test/**/*.browser.e2e.test.ts'
                  : 'e2e/test/**/*.e2e.test.ts',
              ],
              exclude: group === 'api' ? ['e2e/test/**/*.browser.e2e.test.ts'] : [],
              globalSetup: ['e2e/src/stack/global-setup.ts'],
              // Fail fast: a broken test costs seconds, not minutes. The few tests that
              // really wait (retry backoff, a whole migration) say so themselves.
              testTimeout: 60_000,
              hookTimeout: 120_000,
              // Files run in parallel, one stack pool per worker (e2e/src/stack/pool.ts). `isolate:
              // false` keeps a worker's module scope between files, which is what lets the
              // next file find the pool's stacks; the tests keep their state in the stack and
              // their own tenant, not in modules.
              fileParallelism: true,
              maxWorkers: Number(process.env['E2E_WORKERS'] ?? 3) || 3,
              isolate: false,
            },
          }))
        : []),
      // The design system's own visual tests (`pnpm test:visual`): every @circi/ui component in
      // both colour schemes, screenshotted by @circi/vitest. Registered only with VISUAL=1, so
      // `pnpm test` never takes screenshots that nobody compares.
      ...(process.env['VISUAL']
        ? [
            {
              extends: true,
              oxc: { jsx: { runtime: 'automatic' as const } },
              // The previews live in .design-sync, outside any package that depends on @circi/ui.
              resolve: {
                alias: [
                  {
                    find: /^@circi\/ui$/,
                    replacement: resolve(import.meta.dirname, 'packages/ui/src/index.ts'),
                  },
                  // Files outside a package can't resolve React: use the design system's copy.
                  ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].map((id) => ({
                    find: new RegExp(`^${id}$`),
                    replacement: uiRequire.resolve(id),
                  })),
                ],
              },
              optimizeDeps: { include: visualOptimizeDeps },
              test: {
                name: 'ui-visual',
                include: ['packages/ui/visual/**/*.visual.test.tsx'],
                // Starts from an empty .circi/screenshots, so nothing stale is uploaded.
                globalSetup: ['packages/ui/visual/clean-screenshots.ts'],
                browser: {
                  enabled: true,
                  headless: true,
                  provider: playwright(),
                  // A fixed viewport: portals (dialogs, drawers) are shot at this size.
                  viewport: { width: 1000, height: 700 },
                  instances: [{ browser: 'chromium' as const }],
                },
              },
            },
          ]
        : []),
      // Component tests run in real headless Chromium (Vitest browser mode): real portals, focus,
      // pointer events and the real compiled CSS modules.
      ...[
        { name: 'ui', root: 'packages/ui', deps: uiOptimizeDeps, setupFiles: [] as string[] },
        {
          name: 'web-browser',
          root: 'apps/web',
          deps: webOptimizeDeps,
          // Resets fetch, mocks, timers, stores and storage after each test (relative to the root).
          setupFiles: ['test/support/setup.ts'],
        },
      ].map(({ name, root, deps, setupFiles }) => ({
        extends: true,
        // The package's own root, so `optimizeDeps.include` resolves from where it is installed.
        root: resolve(import.meta.dirname, root),
        oxc: { jsx: { runtime: 'automatic' as const } },
        optimizeDeps: { include: deps },
        test: {
          name,
          setupFiles,
          include: ['test/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' as const }],
          },
        },
      })),
    ],
  },
})
