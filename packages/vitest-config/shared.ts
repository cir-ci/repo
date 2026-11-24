import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ViteUserConfig } from 'vitest/config'
import type { Reporter } from 'vitest/node'

import RetryReporter from './retry-reporter.ts'

/**
 * What every package's Vitest config shares. Each package runs its own tests from its own folder
 * (`pnpm test` there, the `test` task in turbo.json): a kind's config (vitest.<kind>.config.ts)
 * spreads this and adds its projects.
 */

/** Pins the time zone and language, and restores mocks and timers after each test (every Node project). */
export const SETUP_NODE = resolve(import.meta.dirname, 'setup-node.ts')

function packageName(root: string): string {
  const pkg: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  return typeof pkg === 'object' && pkg !== null && 'name' in pkg && typeof pkg.name === 'string'
    ? pkg.name
    : root
}

// On CI, every run also reports its tests to Flakiness.io (project CirCI/repo), which tracks which
// tests fail now and then. It uploads with FLAKINESS_ACCESS_TOKEN (from the CircleCI context Flakiness;
// CircleCI has no OIDC sign-in the reporter knows) and only writes the report without it, as on a
// pull request from a fork. Each package's tests are their own Vitest process (Turbo runs them in
// parallel), so each report is titled by the package and goes to that package's folder.
// turbo.json passes CI, CIRCLE_BUILD_URL and the FLAKINESS_ variables through without hashing
// them: a report doesn't change a run's result, and a token must never be part of a cache key.
function flakiness(label: string): [string, Record<string, unknown>][] {
  if (!process.env['CI']) return []
  // The report links to the CI job through BUILD_URL, which CircleCI calls CIRCLE_BUILD_URL.
  const circleBuild = process.env['CIRCLE_BUILD_URL']
  if (circleBuild) process.env['BUILD_URL'] ??= circleBuild
  // By name, as its README does: the package's default export is a class whose types its package.json
  // doesn't point to.
  return [
    [
      '@flakiness/vitest',
      { flakinessProject: 'CirCI/repo', title: label, outputFolder: 'flakiness-report' },
    ],
  ]
}

export interface BaseOptions {
  /** Replaces the retry reporter (the end-to-end runs report their timings instead). */
  reporter?: Reporter
}

/** The settings of every package's run; `root` is the package's folder. */
export function base(root: string, { reporter }: BaseOptions = {}): ViteUserConfig {
  return {
    root,
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
      // Component runs also list the tests that passed only on their retry (.vitest/retried-tests.txt).
      reporters: ['default', reporter ?? new RetryReporter(), ...flakiness(packageName(root))],
      // Stopping an end-to-end stack (docker compose down -v) happens in global teardown.
      teardownTimeout: 120_000,
      // `pnpm test:coverage` (the Node projects: browser projects need their own provider setup).
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'html'],
        include: ['src/**/*.ts'],
        exclude: ['**/*.d.ts', '**/dist/**', 'src/migrations/**'],
      },
    },
  }
}
