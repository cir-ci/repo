import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sleep } from '#fakes/http.ts'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** A lock whose owner died (or never wrote its pid and is older than a few seconds) is stale. */
function stale(dir: string): boolean {
  try {
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'))
    return Number.isInteger(pid) && pid > 0 ? !alive(pid) : false
  } catch {
    try {
      return Date.now() - statSync(dir).mtimeMs > 10_000
    } catch {
      return false
    }
  }
}

/**
 * Runs `task` while holding a machine-wide lock named `name` (an atomic `mkdir` in the temp
 * directory), so two e2e groups started by turbo in parallel do not `docker build` the same
 * tag at once: the second waits, then its build is all layer-cache hits. A lock left by a
 * killed process is taken over.
 */
export async function withBuildLock<T>(
  name: string,
  task: () => Promise<T>,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
  const dir = join(tmpdir(), `circi-e2e-lock-${name.replace(/[^\w.-]/g, '_')}`)
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000)
  for (;;) {
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'pid'), String(process.pid))
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (stale(dir)) {
        rmSync(dir, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for the build lock ${dir}`, { cause: error })
      await sleep(options.pollMs ?? 500)
    }
  }
  try {
    return await task()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
