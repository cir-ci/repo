import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * What an end-to-end result depends on that is not in the repository: the Chromium that
 * Playwright drives (its pinned build, from playwright-core's browsers.json, so nothing is
 * launched) and the Docker server that runs the stack. Printed by
 * `node e2e/src/stack/env-fingerprint.ts`; `pnpm gate:full` and `pnpm e2e:*` put it in
 * `E2E_ENV_FINGERPRINT`, which turbo.json lists in the `env` of both e2e tasks, so a new
 * Chromium or Docker invalidates their cache and an unchanged setup stays a cache hit.
 */
export function envFingerprint(): string {
  const fromRoot = createRequire(import.meta.url)
  const fromPlaywright = createRequire(fromRoot.resolve('playwright/package.json'))
  const corePackage = fromPlaywright.resolve('playwright-core/package.json')
  const core = JSON.parse(readFileSync(corePackage, 'utf8')) as { version: string }
  const browsers = JSON.parse(
    readFileSync(join(dirname(corePackage), 'browsers.json'), 'utf8'),
  ) as {
    browsers: { name: string; revision: string; browserVersion?: string }[]
  }
  const chromium = browsers.browsers.find((b) => b.name === 'chromium')
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  const dockerVersion = docker.status === 0 ? docker.stdout.trim() : 'unavailable'
  return [
    `playwright=${core.version}`,
    `chromium=${chromium?.browserVersion ?? '?'}@${chromium?.revision ?? '?'}`,
    `docker=${dockerVersion}`,
  ].join(';')
}

if (import.meta.main) process.stdout.write(`${envFingerprint()}\n`)
