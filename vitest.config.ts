import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { circiTokensCss } from '@circi/ui/tokens-css'
import { circi } from '@circi/vitest'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { browserEnv } from './e2e/src/clients/no-netlink.ts'
import { E2eTimingReporter } from './e2e/src/reporting/timing-reporter.ts'

// Only built for a visual run (`VISUAL=1`): on Linux that compiles the preload library once.
const visualBrowserEnv = process.env['VISUAL'] ? browserEnv() : undefined

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
  'combobox',
  'context-menu',
  'dialog',
  'drawer',
  'field',
  'fieldset',
  'input',
  'menu',
  'number-field',
  'popover',
  'radio',
  'radio-group',
  'scroll-area',
  'select',
  'slider',
  'switch',
  'tabs',
  'toast',
  'toggle',
  'toggle-group',
  'tooltip',
].map((part) => `@base-ui/react/${part}`)
// Base UI and lucide are installed under @circi/ui; projects rooted elsewhere go through it.
const viaUi = (ids: string[]) => ids.map((id) => `@circi/ui > ${id}`)
// The project icons load from `lucide-react/dynamic.mjs` on demand: listed so a first run doesn't
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
  // Visual runs (`pnpm test:visual`) take `toMatchScreenshot` over (captures go to
  // .circi/screenshots) and send them to CirCI when CIRCI_API_URL and CIRCI_TOKEN are set.
  plugins: [
    circiTokensCss(),
    ...(process.env['VISUAL'] ? [circi({ name: 'ui-chromium', wait: true })] : []),
  ],
  // Workspace packages that Vitest runs through Node itself (e.g. @circi/testing) need the condition too.
  ssr: { resolve: { externalConditions: ['node', '@circi/source'] } },
  resolve: {
    conditions: ['@circi/source'],
  },
  // Build output is never test input. A build running beside the tests (the gate runs them in
  // parallel) rewrites thousands of files there, the Rust crate's target/ above all, and a watcher
  // that sees them can reload a browser test's page mid-run ("Cannot find vitest-iframe").
  server: {
    watch: { ignored: ['**/target/**', '**/dist/**', '**/.turbo/**', '**/perf/.state/**'] },
  },
  test: {
    testTimeout: 30_000,
    // `beforeAll(createTestDb)` under parallel workers is where the 10 s default used to time out.
    hookTimeout: 60_000,
    expect: { poll: { timeout: 5_000, interval: 50 } },
    // End-to-end runs also write e2e/.artifacts/timings.json and print a timing summary.
    ...(process.env['E2E'] ? { reporters: ['default', new E2eTimingReporter()] } : {}),
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
            // The `pnpm dev` environment's pure logic.
            'dev/test/**/*.test.ts',
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
              // A broken test costs a minute or two, not more. The few tests that really wait
              // (retry backoff, a whole migration) say so themselves. Generous because CircleCI's
              // 4 vCPU run both groups, their stacks and Chromium at once and took twice as long as
              // a laptop for the same file (a stack alone took 17 to 61 s to boot): 60 s and a 5 s
              // poll failed there on tests that need 10 s elsewhere.
              testTimeout: 120_000,
              hookTimeout: 240_000,
              expect: { poll: { timeout: 20_000, interval: 50 } },
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
      // The shipped Compose files (deploy/), brought up for real: `pnpm test:compose`, the CircleCI
      // job `compose-smoke`. Own project and switch because it needs no end-to-end stack pool.
      ...(process.env['COMPOSE_SMOKE']
        ? [
            {
              extends: true,
              test: {
                name: 'compose',
                include: ['e2e/test/deploy/**/*.deploy.test.ts'],
                // `compose up --build` builds the image the first time; `down -v` runs in afterAll.
                testTimeout: 120_000,
                hookTimeout: 20 * 60_000,
                fileParallelism: false,
              },
            },
          ]
        : []),
      // The design system's own visual tests (`pnpm test:visual`): every @circi/ui component in
      // both colour schemes, screenshotted by `toMatchScreenshot` under the @circi/vitest plugin. Registered only with VISUAL=1, so
      // `pnpm test` never takes screenshots that nobody compares.
      ...(process.env['VISUAL']
        ? [
            {
              extends: true,
              oxc: { jsx: { runtime: 'automatic' as const } },
              // The previews (packages/ui/visual/previews) import `@circi/ui` by name: point it at the source.
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
              // `entries` starts the dependency scan from the test file and its previews, so the
              // optimiser knows every dependency before the browser asks for the first module: one
              // found while the page already runs is re-optimised, the page reloads, and its pending
              // imports fail with "Failed to fetch dynamically imported module".
              optimizeDeps: {
                include: visualOptimizeDeps,
                entries: ['packages/ui/visual/**/*.tsx'],
              },
              test: {
                name: 'ui-visual',
                include: ['packages/ui/visual/**/*.visual.test.tsx'],
                // The same wait for the test file's iframe, which is ready only once the whole design
                // system and every preview are transformed and loaded: Vitest gives it 60 s by default
                // (read in the browser from the config's env), and a loaded CI machine took longer
                // ("The iframe … did not become ready within 60000ms", so no test ran).
                env: { VITEST_BROWSER_IFRAME_TIMEOUT: '300000' },
                browser: {
                  enabled: true,
                  headless: true,
                  // The end-to-end suite runs this beside its Docker stacks: on Linux the browser must
                  // not hear of the host's network changes, or it aborts its module requests
                  // ("Failed to fetch dynamically imported module"); see e2e/src/clients/no-netlink.ts.
                  provider: visualBrowserEnv
                    ? playwright({ launchOptions: { env: visualBrowserEnv } })
                    : playwright(),
                  // A fixed viewport: portals (dialogs, drawers) are shot at this size.
                  viewport: { width: 1000, height: 700 },
                  // The page connects to the runner only after Vite has optimised and served the
                  // whole design system: a loaded CI machine (the end-to-end stacks beside it) takes
                  // well over the default 60 s ("Failed to connect to the browser session").
                  connectTimeout: 300_000,
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
          // One retry: under a full gate the browser runner itself sometimes loses a test's frame
          // ("Frame was detached", "Cannot find vitest-iframe"), a different test each time and never
          // an assertion. A retried test is still listed in the report, so a real flake stays visible.
          retry: 1,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // A desktop window unless a test says otherwise (the phone layout starts below 820px).
            viewport: { width: 1000, height: 700 },
            instances: [{ browser: 'chromium' as const }],
          },
        },
      })),
    ],
  },
})
