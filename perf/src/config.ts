import { join } from 'node:path'

/** Where things are and which ports the performance stack uses (none of them are the dev stack's). */
export const REPO_ROOT = join(import.meta.dirname, '..', '..')
export const PERF_DIR = join(REPO_ROOT, 'perf')
export const COMPOSE_FILE = join(PERF_DIR, 'compose.yml')
export const COMPOSE_PROJECT = 'circi-perf'
export const FIXTURES_DIR = join(PERF_DIR, 'fixtures')
export const MANIFEST_FILE = join(FIXTURES_DIR, 'manifest.json')
/** Pids, logs, stored files and the seed's outputs (gitignored). `pnpm perf:down` deletes it. */
export const STATE_DIR = join(PERF_DIR, '.state')
export const STACK_FILE = join(STATE_DIR, 'stack.json')
export const SEED_FILE = join(STATE_DIR, 'seed.json')
export const RESULTS_DIR = join(PERF_DIR, 'results')
export const SERVER_BUNDLE = join(REPO_ROOT, 'apps', 'server', 'dist', 'main.mjs')

const port = (name: string, fallback: number): number => {
  const raw = process.env[name]
  const value = raw ? Number(raw) : fallback
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be a port number, got "${raw}"`)
  }
  return value
}

export const PORTS = {
  server: port('PERF_PORT', 3310),
  postgres: port('PERF_POSTGRES_PORT', 54349),
}

export const URL_BASE = `http://127.0.0.1:${PORTS.server}`

export const SEED = {
  email: 'perf@example.com',
  password: 'circi-perf-password',
  workspace: { name: 'Perf', slug: 'perf' },
  project: { name: 'Web app', slug: 'web-app' },
}

export type DiffEngine = 'js' | 'js-workers' | 'native'

export const isEngine = (value: string | undefined): value is DiffEngine =>
  value === 'js' || value === 'js-workers' || value === 'native'

/** The environment of the server and the worker: the built bundle, as the image would run it. */
export function serverEnv(engine: DiffEngine | undefined): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: `postgres://circi:perf@127.0.0.1:${PORTS.postgres}/circi`,
    PUBLIC_URL: URL_BASE,
    PORT: String(PORTS.server),
    HOST: '127.0.0.1',
    BETTER_AUTH_SECRET: 'circi-perf-secret-circi-perf-secret-0123456789',
    LOG_LEVEL: 'warn',
    STORAGE_DRIVER: 'fs',
    STORAGE_PATH: join(STATE_DIR, 'files'),
    CIRCI_MIGRATIONS: join(REPO_ROOT, 'packages', 'db', 'migrations'),
    CIRCI_WEB_DIST: join(REPO_ROOT, 'apps', 'web', 'dist'),
    ...(engine ? { CIRCI_DIFF_ENGINE: engine } : {}),
  }
}
