import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { circi } from './circi.ts'
import {
  COMPOSE_FILE,
  COMPOSE_PROJECT,
  type DiffEngine,
  PORTS,
  REPO_ROOT,
  SERVER_BUNDLE,
  STACK_FILE,
  STATE_DIR,
  URL_BASE,
  isEngine,
  serverEnv,
} from './config.ts'
import { ensureFixtures } from './fixtures.ts'
import { seed } from './seed.ts'

const exec = promisify(execFile)

/** What `perf:stack up` records so the runner and `down` can find the processes. */
export interface StackState {
  engine: DiffEngine | null
  serverPid: number
  workerPid: number
  startedAt: string
}

const log = (line: string) => console.log(`[perf:stack] ${line}`)

const compose = (...args: string[]) =>
  exec('docker', ['compose', '-p', COMPOSE_PROJECT, '-f', COMPOSE_FILE, ...args], {
    env: { ...process.env, PERF_POSTGRES_PORT: String(PORTS.postgres) },
    maxBuffer: 16 * 1024 * 1024,
  })

export function readStack(): StackState | undefined {
  if (!existsSync(STACK_FILE)) return undefined
  // Written by `up` below.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(readFileSync(STACK_FILE, 'utf8')) as StackState
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const isUp = (): boolean => {
  const state = readStack()
  return state !== undefined && alive(state.serverPid) && alive(state.workerPid)
}

async function waitFor(what: string, probe: () => Promise<boolean>, seconds = 90): Promise<void> {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    if (await probe().catch(() => false)) return
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${what} did not come up within ${seconds}s (see perf/.state/logs)`)
}

async function ensureBuilt(): Promise<void> {
  if (existsSync(SERVER_BUNDLE)) return
  log('No server bundle: running `pnpm build` (the production-like bundle, not node --watch)')
  await exec('pnpm', ['build'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
}

function spawnDetached(name: string, args: string[], engine: DiffEngine | undefined): number {
  const logs = join(STATE_DIR, 'logs')
  mkdirSync(logs, { recursive: true })
  const out = openSync(join(logs, `${name}.log`), 'a')
  const child = spawn(process.execPath, [SERVER_BUNDLE, ...args], {
    env: { ...process.env, ...serverEnv(engine) },
    detached: true,
    stdio: ['ignore', out, out],
  })
  child.unref()
  if (child.pid === undefined) throw new Error(`Could not start ${name}`)
  return child.pid
}

function stopProcesses(): void {
  const state = readStack()
  if (!state) return
  for (const pid of [state.serverPid, state.workerPid]) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  rmSync(STACK_FILE, { force: true })
}

async function waitGone(pids: number[]): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && pids.some(alive)) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((r) => setTimeout(r, 200))
  }
  for (const pid of pids) {
    if (alive(pid)) process.kill(pid, 'SIGKILL')
  }
}

/**
 * Brings the stack up (or restarts its server and worker with another diff engine): Postgres in
 * its own compose project, then the built server (`serve`) and worker (`worker`) as two
 * processes, so the CPU and memory of each can be told apart. The first start also seeds.
 */
export async function up(engine: DiffEngine | undefined): Promise<StackState> {
  await ensureBuilt()
  const previous = readStack()
  if (previous) {
    stopProcesses()
    await waitGone([previous.serverPid, previous.workerPid])
  }
  mkdirSync(STATE_DIR, { recursive: true })
  log(`Postgres (project ${COMPOSE_PROJECT}, port ${PORTS.postgres})`)
  await compose('up', '-d', '--wait', 'postgres')
  log('Migrating')
  await circi(['migrate'], engine)

  const serverPid = spawnDetached('server', ['serve', '--no-migrate'], engine)
  const workerPid = spawnDetached('worker', ['worker', '--no-migrate'], engine)
  await waitFor('the server', async () => (await fetch(`${URL_BASE}/readyz`)).ok)
  const state: StackState = {
    engine: engine ?? null,
    serverPid,
    workerPid,
    startedAt: new Date().toISOString(),
  }
  writeFileSync(STACK_FILE, `${JSON.stringify(state, null, 2)}\n`)
  log(
    `Server pid ${serverPid} and worker pid ${workerPid} on ${URL_BASE}, diff engine: ${engine ?? 'default'}`,
  )

  const manifest = await ensureFixtures(log)
  await seed(manifest, { log: (line) => log(line) })
  return state
}

/** Stops both processes, removes the database volume and every file the stack wrote. */
export async function down(): Promise<void> {
  const state = readStack()
  stopProcesses()
  if (state) await waitGone([state.serverPid, state.workerPid])
  await compose('down', '-v', '--remove-orphans').catch((err: unknown) => {
    log(`docker compose down failed: ${String(err)}`)
  })
  rmSync(STATE_DIR, { recursive: true, force: true })
  log('Down: processes stopped, database volume and perf/.state removed')
}

if (import.meta.main) {
  const [command = 'up', ...rest] = process.argv.slice(2)
  const at = rest.indexOf('--engine')
  const requested = at >= 0 ? rest[at + 1] : process.env.CIRCI_DIFF_ENGINE
  if (requested !== undefined && requested !== '' && !isEngine(requested)) {
    throw new Error(`--engine must be js, js-workers or native, got "${requested}"`)
  }
  const engine = requested && isEngine(requested) ? requested : undefined
  if (command === 'up') await up(engine)
  else if (command === 'down') await down()
  else if (command === 'status') console.log(isUp() ? JSON.stringify(readStack(), null, 2) : 'down')
  else throw new Error(`Unknown command "${command}": use up, down or status`)
}
