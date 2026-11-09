import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ValidationError, WORKSPACE_PICTURE_MAX_BYTES, workspacePictureSha } from '@circi/core'
import { getWorkspacePicture } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { createTestDb, seedWorkspace } from '@circi/db/testing'
import { readPngInfo } from '@circi/diff'
import { FsStorage } from '@circi/storage'
import { imageBytes } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runRetention, storeWorkspacePicture } from '#src/index.ts'

let t: createTestDb.Result
let dir: string
let storage: FsStorage
beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-picture-'))
  storage = new FsStorage({ path: dir })
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await t.reset()
})

const image = (format: imageBytes.Options['format'], color: string) =>
  imageBytes({ format, color, width: 300, height: 200 })

/** What the route does after the service: better-auth writes the logo. */
const setLogo = (workspaceId: string, logo: string | null) =>
  t.db.update(schema.workspace).set({ logo }).where(eq(schema.workspace.id, workspaceId))

describe('storeWorkspacePicture', () => {
  it('stores a 256 px square PNG under its hash and names it for the logo', async () => {
    const stored = await storeWorkspacePicture(t.db, storage, {
      bytes: await image('jpeg', '#336699'),
    })
    expect(workspacePictureSha(stored.logo)).toBe(stored.sha256)
    const { workspace } = await seedWorkspace(t.db)
    await setLogo(workspace.id, stored.logo)
    const picture = await getWorkspacePicture(t.db, workspace.id)
    expect(picture).toMatchObject({ sha256: stored.sha256, contentType: 'image/png' })
    const chunks: Buffer[] = []
    for await (const chunk of await storage.get(picture?.storageKey ?? '')) {
      chunks.push(Buffer.from(chunk))
    }
    expect(await readPngInfo(Buffer.concat(chunks))).toEqual({ width: 256, height: 256 })
  })

  it('stores the same picture once', async () => {
    const bytes = await image('png', '#336699')
    const a = await storeWorkspacePicture(t.db, storage, { bytes })
    const b = await storeWorkspacePicture(t.db, storage, { bytes })
    expect(b.sha256).toBe(a.sha256)
    expect(await t.db.select().from(schema.files)).toHaveLength(1)
  })

  it('refuses empty uploads, anything over 1 MB, and what is not a PNG, JPEG or WebP', async () => {
    await expect(storeWorkspacePicture(t.db, storage, { bytes: Buffer.alloc(0) })).rejects.toThrow(
      ValidationError,
    )
    await expect(
      storeWorkspacePicture(t.db, storage, {
        bytes: Buffer.alloc(WORKSPACE_PICTURE_MAX_BYTES + 1),
      }),
    ).rejects.toThrow('larger than 1 MB')
    await expect(
      storeWorkspacePicture(t.db, storage, { bytes: await image('gif', '#000') }),
    ).rejects.toThrow(/PNG, JPEG or WebP/)
    await expect(
      storeWorkspacePicture(t.db, storage, { bytes: Buffer.from('<svg></svg>') }),
    ).rejects.toThrow(ValidationError)
    expect(await t.db.select().from(schema.files)).toHaveLength(0)
  })
})

/** One run marks what nothing names, the next collects it. */
async function sweep(deleted: string[]) {
  const run = () =>
    runRetention(t.db, { graceMs: 0, deleteObject: async (key) => void deleted.push(key) })
  await run()
  await run()
}

describe('storage GC and workspace pictures', () => {
  it('keeps the live picture, and collects one that was replaced or removed', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const first = await storeWorkspacePicture(t.db, storage, {
      bytes: await image('png', '#aa0000'),
    })
    await setLogo(workspace.id, first.logo)
    const deleted: string[] = []
    await sweep(deleted)
    expect(deleted).toEqual([])
    expect(await getWorkspacePicture(t.db, workspace.id)).toBeDefined()

    const second = await storeWorkspacePicture(t.db, storage, {
      bytes: await image('png', '#00aa00'),
    })
    await setLogo(workspace.id, second.logo)
    await sweep(deleted)
    expect(deleted).toHaveLength(1)
    const rows = await t.db.select({ sha: schema.files.sha256 }).from(schema.files)
    expect(rows.map((r) => r.sha)).toEqual([second.sha256])

    await setLogo(workspace.id, null)
    await sweep(deleted)
    expect(deleted).toHaveLength(2)
    expect(await t.db.select().from(schema.files)).toHaveLength(0)
  })

  it('does not collect a picture another workspace still names', async () => {
    const a = await seedWorkspace(t.db)
    const b = await seedWorkspace(t.db)
    const bytes = await image('png', '#0000aa')
    const stored = await storeWorkspacePicture(t.db, storage, { bytes })
    await setLogo(a.workspace.id, stored.logo)
    await setLogo(b.workspace.id, stored.logo)
    await setLogo(a.workspace.id, null)
    const deleted: string[] = []
    await sweep(deleted)
    expect(deleted).toEqual([])
    expect(await getWorkspacePicture(t.db, b.workspace.id)).toBeDefined()
  })
})
