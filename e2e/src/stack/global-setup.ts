import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { withBuildLock } from './build-lock.ts'
import { assertDocker, removeRunProjectsSync, run } from './docker.ts'
import { ARTIFACTS_DIR, REPO_ROOT } from './paths.ts'

let imageBuild: Promise<void> | undefined

async function buildImage(): Promise<void> {
  const started = Date.now()
  console.log('[e2e] building circi:e2e (docker layer cache applies)...')
  // `//#e2e:api` and `//#e2e:browser` run in parallel under turbo, each in its own process:
  // the lock (keyed on the tag) lets one build while the other waits and then reuses its layers.
  const built = await withBuildLock('circi-e2e', () =>
    run('docker', ['build', '-q', '-f', 'deploy/Dockerfile', '-t', 'circi:e2e', '.'], {
      cwd: REPO_ROOT,
      timeoutMs: 30 * 60_000,
      allowFail: true,
    }),
  )
  if (built.code !== 0) {
    throw new Error(`docker build of circi:e2e failed:\n${built.stderr || built.stdout}`)
  }
  console.log(`[e2e] image ready in ${Math.round((Date.now() - started) / 1000)}s`)
}

/**
 * Runs once per `pnpm test:e2e`, in the main process:
 *  1. fails fast, with a clear message, when Docker is not available;
 *  2. builds the `circi:e2e` image from deploy/Dockerfile (docker's layer cache makes a rebuild
 *     without changes take seconds; E2E_SKIP_BUILD=1 reuses the existing image);
 *  3. on the way out (also on failure and Ctrl-C) removes every compose project of this run.
 */
export default async function setup(): Promise<() => Promise<void>> {
  assertDocker()
  const runId = process.env['E2E_RUN_ID'] ?? randomBytes(3).toString('hex')
  // Test workers are forked after this, so they inherit it and name their projects with it.
  process.env['E2E_RUN_ID'] = runId
  mkdirSync(ARTIFACTS_DIR, { recursive: true })
  // The per-stack phase timings of this run (see stack.ts and timing-reporter.ts).
  rmSync(join(ARTIFACTS_DIR, 'stack-phases.jsonl'), { force: true })

  // Both e2e projects (`e2e-api`, `e2e-browser`) list this file, so a run of both calls it twice.
  if (!process.env['E2E_SKIP_BUILD']) await (imageBuild ??= buildImage())

  const keep = Boolean(process.env['E2E_KEEP'])
  const cleanup = () => {
    if (keep) return
    const removed = removeRunProjectsSync(runId)
    if (removed.length > 0) console.log(`[e2e] removed leftover stacks: ${removed.join(', ')}`)
  }
  const onSignal = (signal: NodeJS.Signals) => {
    cleanup()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('exit', cleanup)

  return () => {
    cleanup()
    return Promise.resolve()
  }
}
