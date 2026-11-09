import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { schema } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedFile, sha256 } from '@circi/testing'
import { Command } from 'commander'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { addAdminCommands } from '#cli/admin.ts'
import type * as RuntimeModule from '#composition/runtime.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'

/** What the mocked runtime hands the commands: the test database and storage. */
const world = vi.hoisted(() => ({ db: undefined as unknown, storage: undefined as unknown }))

// The commands open a runtime from the environment (a real Postgres pool). Keep the real one, and
// swap in the PGlite database and a temp-dir storage; nothing else about the commands is faked.
vi.mock('#composition/runtime.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeModule>()
  return {
    ...actual,
    createRuntime: (env: Record<string, string | undefined>) => {
      const rt = actual.createRuntime(env)
      return {
        ...rt,
        db: { ...rt.db, db: world.db },
        storage: world.storage,
      }
    },
  }
})

const bytes = Buffer.from('a')

let t: createTestDb.Result
let dir: string
let storage: FsStorage
let reset: () => Promise<void>

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-admin-'))
  storage = new FsStorage({ path: join(dir, 'files') })
  world.db = t.db
  world.storage = storage
  vi.stubEnv('DATABASE_URL', 'postgres://localhost:1/unused')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-123')
  vi.stubEnv('PUBLIC_URL', 'https://ci.acme.io')
  vi.stubEnv('STORAGE_PATH', join(dir, 'files'))
  await storage.put(`k/${sha256(bytes)}`, bytes)
  await seedFile(t.db, { sha256: sha256(bytes) })
  reset = await snapshotDb(t)
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})
beforeEach(() => reset())
afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

async function run(...args: string[]): Promise<string[]> {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  const program = new Command().exitOverride()
  addAdminCommands(program)
  await program.parseAsync(['admin', 'storage', ...args], { from: 'user' })
  return lines
}

describe('circi admin storage', () => {
  it('usage --json prints what is stored', async () => {
    const [json] = await run('usage', '--json')
    expect(JSON.parse(json ?? '')).toMatchObject({
      totalBytes: 1,
      files: [{ kind: 'screenshot', count: 1, bytes: 1 }],
    })
  })

  it('usage prints a line per kind and the grace period', async () => {
    const lines = await run('usage')
    expect(lines[0]).toMatch(/^screenshot\s+1 files/)
    expect(lines.at(-1)).toContain('waiting to be deleted: 0 files')
    expect(lines.at(-1)).toContain('24 h grace period')
  })

  it('migrate refuses without a target', async () => {
    await expect(run('migrate', '--to', 'fs')).rejects.toThrow(/--to fs --path <dir>/)
    await expect(run('migrate', '--to', 's3')).rejects.toThrow(/--bucket <name>/)
  })

  it('migrate copies every file to the target under the same key', async () => {
    const target = join(dir, 'target')
    const lines = await run('migrate', '--to', 'fs', '--path', target)
    expect(lines[0]).toBe('Copied 1, already there 0, missing at the source 0, failed 0.')
    expect(await readFile(join(target, 'k', sha256(bytes)))).toEqual(bytes)
    expect(process.exitCode).toBeUndefined()
    // Run again: it resumes, copying nothing.
    const again = await run('migrate', '--to', 'fs', '--path', target)
    expect(again[0]).toBe('Copied 0, already there 1, missing at the source 0, failed 0.')
  })

  it('gc rejects a negative or non-numeric grace period', async () => {
    await expect(run('gc', '--grace-hours', '-1')).rejects.toThrow(/0 or more/)
    await expect(run('gc', '--grace-hours', 'soon')).rejects.toThrow(/0 or more/)
  })

  it('gc --dry-run lists what would be deleted and changes nothing', async () => {
    const old = Buffer.from('unused-and-old')
    const oldKey = `k/${sha256(old)}`
    await seedFile(t.db, { sha256: sha256(old) })
    await storage.put(oldKey, old)
    await t.db
      .update(schema.files)
      .set({ gcMarkedAt: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(schema.files.sha256, sha256(old)))
    const before = await t.db.select().from(schema.files)

    const lines = await run('gc', '--grace-hours', '24', '--dry-run')
    expect(lines[0]).toContain('nothing is deleted or marked')
    expect(lines[1]).toContain('Would delete 1 files')
    expect(lines).toContain(`  ${oldKey}`)
    expect(lines.at(-1)).toContain('1 more unused files would be marked')
    // Nothing deleted, nothing marked.
    expect(await t.db.select().from(schema.files)).toEqual(before)
    expect(await storage.head(oldKey)).not.toBeNull()
    await storage.delete(oldKey)
    await t.db.delete(schema.files).where(eq(schema.files.sha256, sha256(old)))
  })

  it('gc runs retention and prints the result as JSON', async () => {
    const [json] = await run('gc', '--grace-hours', '24')
    expect(JSON.parse(json ?? '')).toBeTypeOf('object')
  })
})
