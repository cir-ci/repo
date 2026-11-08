import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { E2eTimingReporter } from './e2e/src/timing-reporter.ts'
import { circiTokensCss } from './packages/ui/tokens-css.ts'

/**
 * Three kinds of test: logic (`*.test.ts`) runs in Node, including the web app's render-free tests;
 * end-to-end tests (`e2e`, Docker) run only on request;
 * components (`*.browser.test.tsx`) run in real headless Chromium through Vitest browser mode.
 */
export default defineConfig({
  // Fills the token variables into @circi/ui's global.css, as the real builds do.
  plugins: [circiTokensCss()],
  resolve: {
    conditions: ['development'],
  },
  test: {
    testTimeout: 30_000,
    // End-to-end runs also write e2e/.artifacts/timings.json and print a timing summary.
    ...(process.env['E2E'] ? { reporters: ['default', new E2eTimingReporter()] } : {}),
    // Stopping an end-to-end stack (docker compose down -v) happens in global teardown.
    teardownTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
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
      ...(process.env['E2E']
        ? [
            {
              extends: true,
              test: {
                name: 'e2e',
                include: ['e2e/test/**/*.e2e.test.ts'],
                globalSetup: ['e2e/src/global-setup.ts'],
                // Fail fast: a broken test costs seconds, not minutes. The few tests that
                // really wait (retry backoff, a whole migration) say so themselves.
                testTimeout: 60_000,
                hookTimeout: 120_000,
                // Files run in parallel, one stack pool per worker (e2e/src/pool.ts). `isolate:
                // false` keeps a worker's module scope between files, which is what lets the
                // next file find the pool's stacks; the tests keep their state in the stack and
                // their own tenant, not in modules.
                fileParallelism: true,
                maxWorkers: Number(process.env['E2E_WORKERS'] ?? 3) || 3,
                isolate: false,
              },
            },
          ]
        : []),
      // Component tests run in real headless Chromium (Vitest browser mode): real portals, focus,
      // pointer events and the real compiled CSS modules.
      ...[
        { name: 'ui', include: ['packages/ui/test/**/*.browser.test.tsx'] },
        { name: 'web-browser', include: ['apps/web/test/**/*.browser.test.tsx'] },
      ].map(({ name, include }) => ({
        extends: true,
        oxc: { jsx: { runtime: 'automatic' as const } },
        test: {
          name,
          include,
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
