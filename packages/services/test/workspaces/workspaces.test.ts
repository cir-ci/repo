import {
  findProjectForMember,
  getProjectContext,
  listUserWorkspaceIds,
  workspaceAcceptsSession,
} from '@circi/db/queries'
import { createBuild, markFileVerified, planUploads } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { addTestMember, createTestDb, seedProject, seedUser } from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  deleteWorkspace,
  finalizeBuild,
  purgeWorkspace,
  restoreWorkspace,
  runRetention,
  WorkspaceDeleteForbiddenError,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const DAY = 86_400_000
const deletedObjects: string[] = []
const deleteObject = async (key: string) => void deletedObjects.push(key)

let counter = 0
/** A workspace with a project, an owner, an admin and a member, and a build with one file. */
async function setup() {
  counter += 1
  const seeded = await seedProject(t.db)
  const admin = await seedUser(t.db)
  const member = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: seeded.workspace.id, userId: admin.id, role: 'admin' })
  await addTestMember(t.db, { workspaceId: seeded.workspace.id, userId: member.id })
  const hash = fakeSha(counter.toString(16).padStart(2, '0'))
  const build = await createBuild(t.db, {
    projectId: seeded.project.id,
    commitSha: `abc${counter.toString().padStart(4, '0')}0`,
    branch: 'feature',
  })
  await planUploads(t.db, {
    buildId: build.id,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 100, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}/ws${counter}`,
  })
  await markFileVerified(t.db, hash, { size: 100 })
  await finalizeBuild(t.db, { buildId: build.id, screenshots: [{ name: 'home', sha256: hash }] })
  return { ...seeded, admin, member, build, hash }
}

const visibleTo = (s: Awaited<ReturnType<typeof setup>>, userId: string) =>
  findProjectForMember(t.db, {
    workspaceSlug: s.workspace.slug,
    projectSlug: s.project.slug,
    userId,
    method: 'password',
  })

describe('deleteWorkspace', () => {
  it('is for owners only', async () => {
    const s = await setup()
    await expect(
      deleteWorkspace(t.db, { workspaceId: s.workspace.id, userId: s.admin.id }),
    ).rejects.toBeInstanceOf(WorkspaceDeleteForbiddenError)
    await expect(
      deleteWorkspace(t.db, { workspaceId: s.workspace.id, userId: s.member.id }),
    ).rejects.toBeInstanceOf(WorkspaceDeleteForbiddenError)
    expect(await visibleTo(s, s.owner.id)).toBeDefined()
  })

  it('hides the workspace from every lookup at once, and restoring brings it all back', async () => {
    const s = await setup()
    expect(await visibleTo(s, s.member.id)).toBeDefined()
    await deleteWorkspace(t.db, { workspaceId: s.workspace.id, userId: s.owner.id })

    expect(await visibleTo(s, s.owner.id)).toBeUndefined()
    expect(await visibleTo(s, s.member.id)).toBeUndefined()
    expect(await workspaceAcceptsSession(t.db, s.workspace.id, 'password')).toBe(false)
    expect(await workspaceAcceptsSession(t.db, s.workspace.id, undefined)).toBe(false)
    expect(await getProjectContext(t.db, s.project.id)).toBeUndefined()
    expect(await listUserWorkspaceIds(t.db, s.owner.id)).not.toContain(s.workspace.id)
    // The slug stays reserved: the row is still there.
    const [row] = await t.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, s.workspace.id))
    expect(row?.slug).toBe(s.workspace.slug)

    await restoreWorkspace(t.db, s.workspace.id)
    expect(await visibleTo(s, s.member.id)).toBeDefined()
    expect(await getProjectContext(t.db, s.project.id)).toBeDefined()
    expect(await workspaceAcceptsSession(t.db, s.workspace.id, 'password')).toBe(true)
    await expect(restoreWorkspace(t.db, s.workspace.id)).rejects.toThrow(/isn't deleted/)
  })

  it('keeps the first deletion time when deleted twice', async () => {
    const s = await setup()
    const first = await deleteWorkspace(t.db, {
      workspaceId: s.workspace.id,
      userId: s.owner.id,
      now: new Date('2026-01-01T00:00:00Z'),
    })
    const second = await deleteWorkspace(t.db, {
      workspaceId: s.workspace.id,
      userId: s.owner.id,
      now: new Date('2026-01-05T00:00:00Z'),
    })
    expect(second.deletedAt).toEqual(first.deletedAt)
    await restoreWorkspace(t.db, s.workspace.id) // the shared database must not purge it later
  })
})

describe('purging', () => {
  it('purges exactly 30 days after deletion, not a moment before, and queues its files', async () => {
    const s = await setup()
    const deletedAt = new Date('2026-03-01T12:00:00Z')
    await deleteWorkspace(t.db, { workspaceId: s.workspace.id, userId: s.owner.id, now: deletedAt })

    const before = await runRetention(t.db, {
      deleteObject,
      now: new Date(deletedAt.getTime() + 30 * DAY - 1),
    })
    expect(before.purgedWorkspaces).toBe(0)
    expect(
      await t.db.select().from(schema.projects).where(eq(schema.projects.id, s.project.id)),
    ).toHaveLength(1)

    const at = new Date(deletedAt.getTime() + 30 * DAY)
    const result = await runRetention(t.db, { deleteObject, now: at })
    expect(result.purgedWorkspaces).toBe(1)
    // Everything under it went with the cascade; the files were marked in the same pass.
    const remaining = await Promise.all(
      [schema.workspace, schema.projects, schema.builds, schema.member].map((table) =>
        t.db.select().from(table),
      ),
    )
    expect(JSON.stringify(remaining)).not.toContain(s.workspace.id)
    expect(await t.db.select().from(schema.builds).where(eq(schema.builds.id, s.build.id))).toEqual(
      [],
    )
    const [file] = await t.db.select().from(schema.files).where(eq(schema.files.sha256, s.hash))
    expect(file?.gcMarkedAt).not.toBeNull()

    // And the usual collection deletes the stored object once its grace period is over.
    deletedObjects.length = 0
    await runRetention(t.db, { deleteObject, now: new Date(at.getTime() + 2 * DAY) })
    expect(deletedObjects.some((k) => k.includes(s.hash))).toBe(true)
  })

  it('purges a restored workspace never, and an instance admin can purge one now', async () => {
    const s = await setup()
    const now = new Date('2026-05-01T00:00:00Z')
    await deleteWorkspace(t.db, { workspaceId: s.workspace.id, userId: s.owner.id, now })
    await restoreWorkspace(t.db, s.workspace.id)
    await runRetention(t.db, { deleteObject, now: new Date(now.getTime() + 90 * DAY) })
    expect(await visibleTo(s, s.owner.id)).toBeDefined()

    await expect(purgeWorkspace(t.db, { workspaceId: s.workspace.id })).rejects.toThrow(
      /isn't deleted/,
    )
    await deleteWorkspace(t.db, { workspaceId: s.workspace.id, userId: s.owner.id, now })
    await purgeWorkspace(t.db, { workspaceId: s.workspace.id, onlyIfDue: true, now })
    expect(await getProjectContext(t.db, s.project.id)).toBeUndefined()
    expect(
      await t.db.select().from(schema.workspace).where(eq(schema.workspace.id, s.workspace.id)),
    ).toHaveLength(1) // not due yet
    await purgeWorkspace(t.db, { workspaceId: s.workspace.id, now })
    expect(
      await t.db.select().from(schema.workspace).where(eq(schema.workspace.id, s.workspace.id)),
    ).toEqual([])
  })
})
