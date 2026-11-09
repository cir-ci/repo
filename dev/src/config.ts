import { join } from 'node:path'

/** Where things are and which ports they use; every port can be moved with an environment variable. */
export const REPO_ROOT = join(import.meta.dirname, '..', '..')
export const COMPOSE_FILE = join(REPO_ROOT, 'dev', 'compose.yml')
/** Files, seed state and the seed's git repository (gitignored). `pnpm dev:reset` deletes it. */
export const STATE_DIR = join(REPO_ROOT, '.dev')
export const SERVER_MAIN = join(REPO_ROOT, 'apps', 'server', 'src', 'main.ts')
export const WEB_DIR = join(REPO_ROOT, 'apps', 'web')

const port = (name: string, fallback: number): number => {
  const raw = process.env[name]
  const value = raw ? Number(raw) : fallback
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be a port number, got "${raw}"`)
  }
  return value
}

export const PORTS = {
  server: port('CIRCI_DEV_PORT', 3000),
  web: port('CIRCI_DEV_WEB_PORT', 5173),
  postgres: port('CIRCI_DEV_POSTGRES_PORT', 54329),
  smtp: port('CIRCI_DEV_SMTP_PORT', 1025),
  mail: port('CIRCI_DEV_MAIL_PORT', 8025),
}

export const URLS = {
  /** The API, for `circi upload` and the seed (the dashboard proxies `/api` here). */
  server: `http://localhost:${PORTS.server}`,
  /** The dashboard, served by Vite with hot reload: PUBLIC_URL, so sign-in cookies and links use it. */
  web: `http://localhost:${PORTS.web}`,
  mail: `http://localhost:${PORTS.mail}`,
}

/** The accounts the seed creates (passwords are for this local database only). */
export const SEED = {
  password: 'circi-dev-password',
  owner: { email: 'owner@example.com', name: 'Olivia Owner' },
  member: { email: 'member@example.com', name: 'Max Member' },
  workspace: { name: 'Acme', slug: 'acme' },
  team: { name: 'Web app', slug: 'web-app' },
}

/** The server's environment: a fixed secret so sessions survive restarts, mail to Mailpit. */
export function serverEnv(): Record<string, string> {
  return {
    DATABASE_URL: `postgres://circi:circi@127.0.0.1:${PORTS.postgres}/circi`,
    PUBLIC_URL: URLS.web,
    PORT: String(PORTS.server),
    HOST: '127.0.0.1',
    BETTER_AUTH_SECRET: 'circi-dev-secret-circi-dev-secret-0123456789',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    STORAGE_DRIVER: 'fs',
    STORAGE_PATH: join(STATE_DIR, 'files'),
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(PORTS.smtp),
    SMTP_FROM: 'CirCI <ci@circi.dev>',
    WEBHOOK_ALLOW_PRIVATE_ADDRESSES: 'true',
    JOB_RETRY_BASE_SECONDS: '1',
    JOB_RETRY_MAX_SECONDS: '10',
  }
}
