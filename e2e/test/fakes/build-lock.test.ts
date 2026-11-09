import { mkdirSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withBuildLock } from '#stack/build-lock.ts'
import { envFingerprint } from '#stack/env-fingerprint.ts'

describe('withBuildLock', () => {
  it('never lets two holders of the same name overlap, and runs both', async () => {
    const name = `test-${process.pid}-${Date.now()}`
    let inside = 0
    let peak = 0
    const task = async () => {
      inside += 1
      peak = Math.max(peak, inside)
      await new Promise((resolve) => setTimeout(resolve, 50))
      inside -= 1
      return 'done'
    }
    const results = await Promise.all([
      withBuildLock(name, task, { pollMs: 5 }),
      withBuildLock(name, task, { pollMs: 5 }),
      withBuildLock(name, task, { pollMs: 5 }),
    ])
    expect(results).toEqual(['done', 'done', 'done'])
    expect(peak).toBe(1)
  })

  it('takes over a lock whose owner is gone, and releases on failure', async () => {
    const name = `stale-${process.pid}-${Date.now()}`
    const dir = join(tmpdir(), `circi-e2e-lock-${name}`)
    mkdirSync(dir)
    // A lock with no pid file that is also old is stale; an unreadable fresh one is not, so age it.
    const old = new Date(Date.now() - 60_000)
    utimesSync(dir, old, old)
    await expect(
      withBuildLock(name, () => Promise.reject(new Error('boom')), { pollMs: 5 }),
    ).rejects.toThrow('boom')
    await expect(withBuildLock(name, () => Promise.resolve(1), { pollMs: 5 })).resolves.toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('envFingerprint', () => {
  it('names the Playwright, Chromium and Docker versions', () => {
    expect(envFingerprint()).toMatch(/^playwright=[\d.]+;chromium=[\d.]+@\d+;docker=\S+$/)
  })
})
