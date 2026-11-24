import { completeSetup, type Session } from '#clients/admin.ts'
import { type FakeGithub, startFakeGithub } from '#fakes/fake-github.ts'

import { removeProjectSync } from './docker.ts'
import { reportPhases, startStack, type Stack } from './stack.ts'

/**
 * Shared stacks. A profile is a stack configuration (`default`, `s3`, `github`); the first
 * test file of a Vitest worker that asks for a profile boots it, later files of that worker reuse
 * it. Files of one worker run one after another, so a shared stack is never used by two at once;
 * every file makes its own tenant (workspace, owner, project) on it, which keeps the files'
 * data apart. Needs `isolate: false` for the e2e project (see @circi/vitest-config's vitest.e2e.config.ts), otherwise every
 * file gets a fresh module scope and with it an empty pool.
 *
 * A worker keeps at most `E2E_POOL_MAX` stacks (default 2; each is about 450 MB, 620 MB with
 * LocalStack): asking for a third profile removes the least recently used one first. Whatever is
 * left is removed when the worker exits, and by the run's global teardown (also on Ctrl-C).
 */

export type Profile = 'default' | 's3' | 'github'

export const PROFILES: Record<Profile, Stack.Options & { github?: boolean }> = {
  default: {},
  // Also serves static sites (the dashboard is then http://127.0.0.1:<port>).
  s3: { storage: 's3', sitesHost: 'sites.localhost' },
  // The fake GitHub lives as long as the stack and is reset by every file that uses it. It answers
  // under /api/v3 (the shape of GitHub Enterprise Server).
  github: { github: true },
}

export interface PoolEntry {
  profile: Profile
  stack: Stack
  /** The first-run account's session: an instance admin. */
  admin: Session
  /** Only for the `github` profile. */
  github: FakeGithub | undefined
}

/** Compose projects alive now, known synchronously for the exit hook. */
const liveProjects = new Set<string>()
const entries = new Map<Profile, Promise<PoolEntry>>()
let exitHookInstalled = false

const maxStacks = () => Math.max(1, Number(process.env['E2E_POOL_MAX'] ?? 2) || 2)

async function boot(profile: Profile, label: string): Promise<PoolEntry> {
  const { github: wantsGithub, ...options } = PROFILES[profile]
  const github = wantsGithub ? await startFakeGithub({ pathPrefix: '/api/v3' }) : undefined
  let stack: Stack
  try {
    stack = await startStack({
      ...options,
      // GitHub gets 4 s per request here (production: 15 s), so a "slow GitHub" test is short.
      ...(github ? { env: { ...github.env(), GITHUB_API_TIMEOUT_SECONDS: '4' } } : {}),
      label,
      profile,
      pooled: true,
    })
  } catch (err) {
    await github?.close()
    throw err
  }
  liveProjects.add(stack.composeProject)
  const began = Date.now()
  let setup
  try {
    setup = await completeSetup(stack, { workspaceName: 'Pool admin' })
  } catch (err) {
    await github?.close()
    await stack.stop()
    liveProjects.delete(stack.composeProject)
    throw err
  }
  stack.phases.setup = Date.now() - began
  reportPhases(stack.composeProject, stack.phases, label, profile)
  return { profile, stack, admin: setup.session, github }
}

async function release(entry: PoolEntry): Promise<void> {
  await entry.github?.close()
  await entry.stack.stop()
  liveProjects.delete(entry.stack.composeProject)
}

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  // Best effort: the worker may be killed without running this; the run's global teardown removes
  // every stack of the run anyway.
  process.once('exit', () => {
    if (process.env['E2E_KEEP']) return
    for (const project of liveProjects) removeProjectSync(project)
  })
}

/** The shared stack of a profile, booted by the first caller in this worker. */
export async function acquire(profile: Profile, label: string): Promise<PoolEntry> {
  installExitHook()
  const existing = entries.get(profile)
  if (existing) {
    // Most recently used goes last.
    entries.delete(profile)
    entries.set(profile, existing)
    return existing
  }
  while (entries.size >= maxStacks()) {
    const [oldest] = entries.keys()
    if (!oldest) break
    const evicted = await entries.get(oldest)?.catch(() => undefined)
    entries.delete(oldest)
    // oxlint-disable-next-line no-await-in-loop -- one at a time
    if (evicted) await release(evicted).catch(() => undefined)
  }
  const booting = boot(profile, label)
  entries.set(profile, booting)
  booting.catch(() => {
    if (entries.get(profile) === booting) entries.delete(profile)
  })
  return booting
}
