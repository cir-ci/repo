import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from 'pg'

import { createDb, migrationsFolder, runMigrations } from '#src/index.ts'

/**
 * The Postgres server the tests run on, and the migrated template database each test file's own
 * database is cloned from (`CREATE DATABASE … TEMPLATE`, a file copy: much cheaper than migrating,
 * and the server, not the test process, holds the memory).
 *
 * The server is `CIRCI_TEST_DATABASE_URL` when it is set (CI's Postgres service container, or one you
 * run yourself), otherwise a container Testcontainers starts once and every later run reuses
 * (`postgres:18-alpine`, labelled by Testcontainers; it keeps running between runs: `docker ps` shows
 * it, `docker rm -f` removes it). Durability is off there (fsync, synchronous_commit,
 * full_page_writes): a crash loses nothing a test needs.
 */
export interface TestServer {
  /** The server, connected to its `postgres` maintenance database. */
  url: string
  /** The migrated database each test database is cloned from. */
  template: string
}

/** Test databases are `circi_test_<pid>_<n>_<random>`: the pid lets a later run drop those of a run that died. */
export const TEST_DATABASE_PREFIX = 'circi_test_'

const IMAGE = 'postgres:18-alpine'
// Durability off (a test server loses nothing it needs in a crash), and room for every package's
// test processes at once: each test database holds a small pool, a LISTEN connection or two.
const SERVER_SETTINGS = [
  'fsync=off',
  'synchronous_commit=off',
  'full_page_writes=off',
  'max_connections=500',
]

/** `url` with its database replaced. */
export function databaseUrl(url: string, database: string): string {
  const u = new URL(url)
  u.pathname = `/${database}`
  return u.toString()
}

/**
 * Serializes work across processes on this machine (every package's test run starts the same
 * server): a directory created atomically in the temp folder, holding its owner's pid, taken over
 * when that process is gone.
 */
async function withMachineLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `${name}.lock`)
  const deadline = Date.now() + 180_000
  for (;;) {
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'pid'), String(process.pid))
      break
    } catch {
      if (!lockHolderAlive(dir)) {
        rmSync(dir, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${dir}`)
      // oxlint-disable-next-line no-await-in-loop -- polling: each wait depends on the last check
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function lockHolderAlive(dir: string): boolean {
  try {
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'))
    return pid > 0 && processAlive(pid)
  } catch {
    // Created but its pid not written yet: give it a moment unless it is old.
    try {
      return Date.now() - statSync(dir).mtimeMs < 5_000
    } catch {
      return false
    }
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err instanceof Error && 'code' in err && err.code === 'EPERM'
  }
}

async function serverUrl(): Promise<string> {
  const given = process.env['CIRCI_TEST_DATABASE_URL']
  if (given) return given
  // Imported only here: CI passes a URL and never loads Testcontainers.
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
  return withMachineLock('circi-test-postgres', async () => {
    const container = await new PostgreSqlContainer(IMAGE)
      .withDatabase('postgres')
      .withUsername('circi')
      .withPassword('circi')
      .withCommand(['postgres', ...SERVER_SETTINGS.flatMap((setting) => ['-c', setting])])
      .withReuse()
      .start()
    return container.getConnectionUri()
  })
}

/** The migrations' names and contents: a new or changed migration makes a new template. */
function migrationsHash(): string {
  const hash = createHash('sha256')
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else hash.update(entry.name).update(readFileSync(path))
    }
  }
  walk(migrationsFolder)
  return hash.digest('hex').slice(0, 12)
}

async function withAdmin<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url, application_name: 'circi-test-admin' })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Arbitrary constant: one process at a time builds the template or sweeps. */
const TEMPLATE_LOCK_KEY = 7_340_183_312

/**
 * The server, with this checkout's migrated template in place (built once per set of migrations,
 * by whichever test run gets there first), and the databases of test runs that died dropped.
 */
export async function prepareTestServer(): Promise<TestServer> {
  const url = await serverUrl()
  const template = `circi_template_${migrationsHash()}`
  await withAdmin(url, async (admin) => {
    await admin.query('select pg_advisory_lock($1)', [TEMPLATE_LOCK_KEY])
    try {
      const { rows } = await admin.query<{ datname: string }>(
        'select datname from pg_database where datname = $1 or datname like $2',
        [template, `${TEST_DATABASE_PREFIX}%`],
      )
      const dead = rows.filter(({ datname }) => {
        const pid = Number(datname.slice(TEST_DATABASE_PREFIX.length).split('_')[0])
        return datname !== template && !processAlive(pid)
      })
      await Promise.all(
        dead.map(({ datname }) =>
          admin.query(`drop database if exists ${quote(datname)} with (force)`),
        ),
      )
      if (rows.some((r) => r.datname === template)) return
      // Built under another name and renamed when complete, so a run that dies halfway leaves no
      // half-migrated template behind.
      const building = `${template}_building`
      await admin.query(`drop database if exists ${quote(building)} with (force)`)
      await admin.query(`create database ${quote(building)}`)
      const handle = createDb({ url: databaseUrl(url, building), poolMax: 1 })
      try {
        await runMigrations(handle)
      } finally {
        await handle.close()
      }
      await admin.query(`alter database ${quote(building)} rename to ${quote(template)}`)
      // A connection to the template would make every clone wait: nothing may connect to it.
      await admin.query(
        `alter database ${quote(template)} with is_template true allow_connections false`,
      )
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [TEMPLATE_LOCK_KEY])
    }
  })
  return { url, template }
}

/** Drops `name` from the server, closing whatever is still connected to it. */
export function dropDatabase(url: string, name: string): Promise<void> {
  return withAdmin(url, async (admin) => {
    await admin.query(`drop database if exists ${quote(name)} with (force)`)
  })
}

/** Creates `name` as a copy of the migrated template, or with no tables at all when `empty`. */
export function cloneTemplate(server: TestServer, name: string, empty = false): Promise<void> {
  return withAdmin(server.url, async (admin) => {
    await admin.query(
      empty
        ? `create database ${quote(name)}`
        : `create database ${quote(name)} template ${quote(server.template)}`,
    )
  })
}
