import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { circiTokensCss } from '@circi/ui/tokens-css'
import { circi } from '@circi/vitest'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config'

import { browserEnv } from './e2e/src/clients/no-netlink.ts'
import { E2eTimingReporter } from './e2e/src/reporting/timing-reporter.ts'
import RetryReporter from './scripts/retry-reporter.ts'

/**
 * One Vitest run, several projects:
 *
 *   node         logic (`*.test.ts`), including the web app's render-free tests     `pnpm test:node`
 *   storybook    @circi/storybook's CLI against a real Storybook build (slow)       `pnpm test:storybook`
 *   deploy       the deploys (deploy/) against @circi/config's lists of settings     `pnpm test:deploy`
 *   ui           @circi/ui's components in headless Chromium                         `pnpm test:ui`
 *   web-browser  the dashboard's components in headless Chromium                     `pnpm test:web-browser`
 *   e2e-api      end-to-end, over HTTP and the CLI, against the Docker stack (E2E=1)  `pnpm test:e2e:api`
 *   e2e-browser  end-to-end, through Chromium (E2E=1)                                `pnpm test:e2e:browser`
 *   compose      the shipped Compose files, brought up for real (COMPOSE_SMOKE=1)    `pnpm test:compose`
 *   ui-visual    every @circi/ui component screenshotted, light and dark (VISUAL=1)  `pnpm test:visual`
 *
 * The last four are registered only when their variable is set, so a plain `vitest run` never
 * starts Docker or takes screenshots nobody compares.
 */
const E2E = Boolean(process.env['E2E'])
const COMPOSE_SMOKE = Boolean(process.env['COMPOSE_SMOKE'])
const VISUAL = Boolean(process.env['VISUAL'])

const root = import.meta.dirname

// Vite pre-bundles the dependencies it finds while a browser project runs, and the first run after
// a new dependency can fail with import errors until it is rerun. Listing them up front makes that
// run optimize them before the first test: add a package here when a browser test starts importing
// one (a run's list is in node_modules/.vite/vitest/*/deps/_metadata.json). Ids resolve from
// the project's root; `a > b` resolves b from where a is installed.
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
// The project icons load from `lucide-react/dynamic.mjs` on demand: listed so a first run doesn't
// discover it mid-test and reload the page.
const iconDeps = ['boring-avatars', 'lucide-react', 'lucide-react/dynamic.mjs']
// Base UI and lucide are installed under @circi/ui; projects rooted elsewhere go through it.
const viaUi = (ids: string[]) => ids.map((id) => `@circi/ui > ${id}`)

/**
 * Headless Chromium at a desktop size unless a test says otherwise (the phone layout starts below
 * 820px). Component tests run with `prefers-reduced-motion: reduce`, which every motion rule in
 * the design system and the dashboard honors: no test waits out a transition. A test of the motion
 * itself switches it off for its own page with `emulateMotion()` (packages/ui/test/support).
 */
function chromium(env?: Record<string, string>, reducedMotion = false) {
  return {
    enabled: true,
    headless: true,
    provider: playwright({
      ...(env ? { launchOptions: { env } } : {}),
      ...(reducedMotion ? { contextOptions: { reducedMotion: 'reduce' as const } } : {}),
    }),
    viewport: { width: 1000, height: 700 },
    instances: [{ browser: 'chromium' as const }],
  }
}

const DEPLOY_SETTINGS_TEST = 'packages/config/test/deploy-settings.test.ts'
// Builds a real Storybook and drives Chromium over it: a project of its own, so it doesn't slow the Node tests.
const STORYBOOK_TEST = 'packages/storybook/test/**/*.integration.test.ts'

const node: TestProjectInlineConfiguration = {
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
    // Its own project (below), so a change to deploy/ reruns that one file, not every Node test.
    exclude: [DEPLOY_SETTINGS_TEST, STORYBOOK_TEST],
  },
}

/**
 * The deploys against @circi/config's lists of settings: reads deploy/ (the image, Compose, the
 * Terraform module, the Helm chart) and packages/config, nothing else. No database, so no PGlite
 * setup. Turbo caches it on those inputs alone (`//#test:deploy`).
 */
const deploy: TestProjectInlineConfiguration = {
  extends: true,
  test: { name: 'deploy', include: [DEPLOY_SETTINGS_TEST] },
}

/**
 * `@circi/storybook` against a real Storybook 10 build (React and Vite), screenshotted in headless
 * Chromium, with only CirCI faked. Slow (it builds Storybook), hence its own project and turbo task
 * (`//#test:storybook`), cached on the storybook and cli packages alone. No database.
 */
const storybook: TestProjectInlineConfiguration = {
  extends: true,
  test: {
    name: 'storybook',
    include: [STORYBOOK_TEST],
    testTimeout: 240_000,
    hookTimeout: 300_000,
  },
}

/**
 * A package's component tests (`test/**\/*.browser.test.tsx`) in real headless Chromium (Vitest
 * browser mode): real portals, focus, pointer events and the real compiled CSS modules. Rooted at
 * the package, so `optimizeDeps.include` resolves from where its dependencies are installed.
 */
function components(
  name: string,
  dir: string,
  deps: string[],
  setupFiles: string[] = [],
): TestProjectInlineConfiguration {
  return {
    extends: true,
    root: resolve(root, dir),
    oxc: { jsx: { runtime: 'automatic' } },
    optimizeDeps: { include: deps },
    test: {
      name,
      setupFiles,
      include: ['test/**/*.browser.test.tsx'],
      // One retry: under a full gate the browser runner itself sometimes loses a test's frame
      // ("Frame was detached", "Cannot find vitest-iframe"), a different test each time and never
      // an assertion. A retried test is still listed in the report, so a real flake stays visible.
      retry: 1,
      browser: chromium(undefined, true),
    },
  }
}

// Fails a test on an unexpected console.error or unhandled rejection (relative to packages/ui).
const ui = components(
  'ui',
  'packages/ui',
  [...baseUiDeps, ...iconDeps, ...reactDeps],
  ['test/setup.ts'],
)

const webBrowser = components(
  'web-browser',
  'apps/web',
  [
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
  ],
  // Resets fetch, mocks, timers, stores and storage after each test (relative to apps/web).
  ['test/support/setup.ts'],
)

/**
 * The end-to-end tests against the real Docker stack, in two groups by file name:
 * `*.browser.e2e.test.ts` drives Chromium (Playwright, or the dashboard through the CLI's host-side
 * Vitest), every other `*.e2e.test.ts` only talks HTTP, the CLI and the fakes (the turbo tasks
 * `//#e2e:api` and `//#e2e:browser`). e2e/test/fakes/e2e-groups.test.ts keeps the names honest.
 */
function e2e(group: 'api' | 'browser'): TestProjectInlineConfiguration {
  const browserFiles = 'e2e/test/**/*.browser.e2e.test.ts'
  return {
    extends: true,
    test: {
      name: `e2e-${group}`,
      ...(group === 'browser'
        ? { include: [browserFiles] }
        : { include: ['e2e/test/**/*.e2e.test.ts'], exclude: [browserFiles] }),
      globalSetup: ['e2e/src/stack/global-setup.ts'],
      // A broken test costs a minute or two, not more. The few tests that really wait (retry
      // backoff, a whole migration) say so themselves. Generous because CircleCI's 4 vCPU run both
      // groups, their stacks and Chromium at once and took twice as long as a laptop for the same
      // file (a stack alone took 17 to 61 s to boot): 60 s and a 5 s poll failed there on tests
      // that need 10 s elsewhere.
      testTimeout: 120_000,
      hookTimeout: 240_000,
      expect: { poll: { timeout: 20_000, interval: 50 } },
      // Files run in parallel, one stack pool per worker (e2e/src/stack/pool.ts). `isolate: false`
      // keeps a worker's module scope between files, which is what lets the next file find the
      // pool's stacks; the tests keep their state in the stack and their own tenant, not in modules.
      fileParallelism: true,
      maxWorkers: Number(process.env['E2E_WORKERS'] ?? 3) || 3,
      isolate: false,
    },
  }
}

/** The shipped Compose files (deploy/), brought up for real: the CircleCI job `compose-smoke`. */
const compose: TestProjectInlineConfiguration = {
  extends: true,
  test: {
    name: 'compose',
    include: ['e2e/test/deploy/**/*.deploy.test.ts'],
    // `compose up --build` builds the image the first time; `down -v` runs in afterAll.
    testTimeout: 120_000,
    hookTimeout: 20 * 60_000,
    fileParallelism: false,
  },
}

/**
 * The design system's visual tests: every @circi/ui component in both color schemes, captured by
 * `toMatchScreenshot` under the @circi/vitest plugin. Rooted at the repository (the screenshots,
 * named by their path from there, go to its .circi), where nothing but @circi/ui is installed: React
 * and the dependencies resolve through it. A function: building the browser's environment compiles
 * the preload library on Linux, which only a visual run needs.
 */
function visual(): TestProjectInlineConfiguration {
  const uiRequire = createRequire(resolve(root, 'packages/ui/package.json'))
  // The end-to-end suite runs this beside its Docker stacks: on Linux the browser must not hear of
  // the host's network changes, or it aborts its module requests ("Failed to fetch dynamically
  // imported module"); see e2e/src/clients/no-netlink.ts.
  const env = browserEnv()
  return {
    extends: true,
    oxc: { jsx: { runtime: 'automatic' } },
    resolve: {
      alias: [
        // The previews (packages/ui/visual/previews) import `@circi/ui` by name: the source.
        { find: /^@circi\/ui$/, replacement: resolve(root, 'packages/ui/src/index.ts') },
        ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].map((id) => ({
          find: new RegExp(`^${id}$`),
          replacement: uiRequire.resolve(id),
        })),
      ],
    },
    // `entries` starts the dependency scan from the test file and its previews, so the optimizer
    // knows every dependency before the browser asks for the first module: one found while the page
    // already runs is re-optimized, the page reloads, and its pending imports fail with "Failed to
    // fetch dynamically imported module".
    optimizeDeps: {
      include: viaUi([...baseUiDeps, ...iconDeps, 'react', 'react/jsx-dev-runtime']),
      entries: ['packages/ui/visual/**/*.tsx'],
    },
    test: {
      name: 'ui-visual',
      include: ['packages/ui/visual/**/*.visual.test.tsx'],
      // The test file's iframe is ready only once the whole design system and every preview are
      // transformed and loaded: Vitest gives it 60 s by default (read in the browser from the
      // config's env), and a loaded CI machine took longer ("The iframe … did not become ready
      // within 60000ms", so no test ran).
      env: { VITEST_BROWSER_IFRAME_TIMEOUT: '300000' },
      browser: {
        ...chromium(env),
        // The page connects to the runner only after Vite has optimized and served the whole design
        // system: a loaded CI machine (the end-to-end stacks beside it) takes well over the default
        // 60 s ("Failed to connect to the browser session").
        connectTimeout: 300_000,
      },
    },
  }
}

export default defineConfig({
  plugins: [
    // Fills the token variables into @circi/ui's global.css, as the real builds do.
    circiTokensCss(),
    // Visual runs: `toMatchScreenshot` captures go to .circi/screenshots/vitest and are sent to CirCI when
    // CIRCI_API_URL and CIRCI_TOKEN are set.
    ...(VISUAL ? [circi({ name: 'ui-chromium', wait: true })] : []),
  ],
  // Workspace packages that Vitest runs through Node itself (e.g. @circi/testing) need the condition too.
  ssr: { resolve: { externalConditions: ['node', '@circi/source'] } },
  resolve: { conditions: ['@circi/source'] },
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
    // Component runs also list the tests that passed only on their retry (.vitest/retried-tests.txt).
    reporters: ['default', E2E ? new E2eTimingReporter() : new RetryReporter()],
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
      node,
      deploy,
      storybook,
      ui,
      webBrowser,
      ...(E2E ? [e2e('api'), e2e('browser')] : []),
      ...(COMPOSE_SMOKE ? [compose] : []),
      ...(VISUAL ? [visual()] : []),
    ],
  },
})
