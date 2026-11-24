import type { TestProjectInlineConfiguration } from 'vitest/config'
import type { Reporter } from 'vitest/node'

import node from './vitest.node.config.ts'

export interface E2eOptions {
  /** The stack's global setup (e2e/src/stack/global-setup.ts), absolute. */
  globalSetup: string
  /** Writes e2e/.artifacts/timings.json and prints a timing summary (the end-to-end runs only). */
  timingReporter: Reporter
}

/**
 * The end-to-end tests against the real Docker stack, in two groups by file name:
 * `*.browser.e2e.test.ts` drives Chromium (Playwright, or the dashboard through the CLI's host-side
 * Vitest), every other `*.e2e.test.ts` only talks HTTP, the CLI and the fakes (the turbo tasks
 * `e2e:api` and `e2e:browser`). test/fakes/e2e-groups.test.ts keeps the names honest.
 */
function e2eGroup(group: 'api' | 'browser', globalSetup: string): TestProjectInlineConfiguration {
  const browserFiles = 'test/**/*.browser.e2e.test.ts'
  return {
    extends: true,
    test: {
      name: `e2e-${group}`,
      ...(group === 'browser'
        ? { include: [browserFiles] }
        : { include: ['test/**/*.e2e.test.ts'], exclude: [browserFiles] }),
      globalSetup: [globalSetup],
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
    include: ['test/deploy/**/*.deploy.test.ts'],
    // `compose up --build` builds the image the first time; `down -v` runs in afterAll.
    testTimeout: 120_000,
    hookTimeout: 20 * 60_000,
    fileParallelism: false,
  },
}

/**
 * `@circi/e2e`: the harness's own fakes as plain Node tests (no Docker), and, only when their
 * variable is set, the end-to-end groups (E2E=1) and the Compose smoke test (COMPOSE_SMOKE=1), so a
 * plain run never starts Docker.
 */
export default function e2e(root: string, { globalSetup, timingReporter }: E2eOptions) {
  const E2E = Boolean(process.env['E2E'])
  const COMPOSE_SMOKE = Boolean(process.env['COMPOSE_SMOKE'])
  return node(root, {
    ...(E2E ? { reporter: timingReporter } : {}),
    include: ['test/fakes/**/*.test.ts'],
    projects: [
      ...(E2E ? [e2eGroup('api', globalSetup), e2eGroup('browser', globalSetup)] : []),
      ...(COMPOSE_SMOKE ? [compose] : []),
    ],
  })
}
