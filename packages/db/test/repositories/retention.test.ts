import {
  createTestDb,
  seedBuild,
  seedFile,
  seedProject,
  seedScreenshot,
  seedSite,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { storageUsage } from '#src/queries/index.ts'
import {
  collectMarkedFiles,
  expireBuilds,
  expireSites,
  listBuildScreenshots,
  markUnreferencedFiles,
  previewCollection,
  unmarkReferencedFiles,
} from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const DAY = 86_400_000
const now = new Date('2026-06-01T00:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY)

async function projectWithRetention(days: number) {
  const seeded = await seedProject(t.db)
  await t.db
    .update(schema.projects)
    .set({ retentionDays: days })
    .where(eq(schema.projects.id, seeded.project.id))
  return seeded.project
}

describe('expireBuilds', () => {
  it('expires old finished builds and their screenshots, but not young or running ones', async () => {
    const project = await projectWithRetention(30)
    const old = await seedBuild(t.db, project.id, {
      branch: 'feature',
      status: 'complete',
      createdAt: daysAgo(40),
    })
    await seedScreenshot(t.db, { buildId: old.id, fileSha256: fakeSha('a') })
    const young = await seedBuild(t.db, project.id, { status: 'complete', createdAt: daysAgo(5) })
    const running = await seedBuild(t.db, project.id, { createdAt: daysAgo(40) })

    expect(await expireBuilds(t.db, now)).toBe(1)
    const status = async (id: string) =>
      (await t.db.select().from(schema.builds).where(eq(schema.builds.id, id)))[0]?.status
    expect(await status(old.id)).toBe('expired')
    expect(await status(young.id)).toBe('complete')
    expect(await status(running.id)).toBe('uploading')
    expect(await listBuildScreenshots(t.db, old.id)).toEqual([])
  })

  it('works through more builds than one batch, oldest first', async () => {
    const project = await projectWithRetention(30)
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- seeding in order
      const b = await seedBuild(t.db, project.id, {
        branch: 'feature',
        status: 'complete',
        createdAt: daysAgo(40 + i),
      })
      // oxlint-disable-next-line no-await-in-loop
      await seedScreenshot(t.db, { buildId: b.id, fileSha256: fakeSha('b') })
      ids.push(b.id)
    }
    const young = await seedBuild(t.db, project.id, { status: 'complete', createdAt: daysAgo(2) })

    // Batches of two: 2 + 2 + 1 builds, three transactions.
    expect(await expireBuilds(t.db, now, 2)).toBe(5)
    const rows = await t.db
      .select()
      .from(schema.builds)
      .where(eq(schema.builds.projectId, project.id))
    const byId = new Map(rows.map((b) => [b.id, b.status]))
    expect(ids.map((id) => byId.get(id))).toEqual(Array(5).fill('expired'))
    expect(byId.get(young.id)).toBe('complete')
    for (const id of ids) {
      // oxlint-disable-next-line no-await-in-loop
      expect(await listBuildScreenshots(t.db, id)).toEqual([])
    }
    expect(await expireBuilds(t.db, now, 2)).toBe(0)
  })

  it('keeps the newest approved default-branch build, which later builds compare against', async () => {
    const project = await projectWithRetention(30)
    const baseline = await seedBuild(t.db, project.id, {
      branch: project.defaultBranch,
      status: 'complete',
      conclusion: 'no_changes',
      createdAt: daysAgo(60),
    })
    const older = await seedBuild(t.db, project.id, {
      branch: project.defaultBranch,
      status: 'complete',
      conclusion: 'no_changes',
      createdAt: daysAgo(90),
    })
    await expireBuilds(t.db, now)
    const rows = await t.db
      .select()
      .from(schema.builds)
      .where(eq(schema.builds.projectId, project.id))
    const byId = new Map(rows.map((b) => [b.id, b.status]))
    expect(byId.get(baseline.id)).toBe('complete')
    expect(byId.get(older.id)).toBe('expired')
  })
})

describe('expireSites', () => {
  it("drops stale branch addresses and unserved old versions, never the default branch's", async () => {
    const project = await projectWithRetention(30)
    const stale = await seedSite(t.db, { projectId: project.id, commitSha: 'a'.repeat(12) })
    await t.db
      .update(schema.staticSites)
      .set({ createdAt: daysAgo(60) })
      .where(eq(schema.staticSites.id, stale.version.id))
    await t.db.insert(schema.siteHostnames).values([
      {
        label: 'stale-branch',
        projectSiteId: stale.site.id,
        linkKind: 'branch',
        branch: 'feature',
        staticSiteId: stale.version.id,
        updatedAt: daysAgo(60),
      },
      {
        label: 'main-branch',
        projectSiteId: stale.site.id,
        linkKind: 'branch',
        branch: project.defaultBranch,
        staticSiteId: stale.version.id,
        updatedAt: daysAgo(60),
      },
    ])
    // The default branch's address still serves the version, so only the stale branch goes.
    expect(await expireSites(t.db, now)).toEqual({ addresses: 1, versions: 0 })
    await t.db.delete(schema.siteHostnames).where(eq(schema.siteHostnames.label, 'main-branch'))
    expect(await expireSites(t.db, now)).toEqual({ addresses: 0, versions: 1 })
    // Both the branch address and the commit address are remembered as expired, for the sites domain to say so.
    expect(
      (await t.db.select().from(schema.expiredSiteHostnames)).map((r) => r.label).toSorted(),
    ).toContain('stale-branch')
    expect(
      await t.db
        .select()
        .from(schema.staticSites)
        .where(eq(schema.staticSites.id, stale.version.id)),
    ).toEqual([])
  })
})

describe('garbage collection of files', () => {
  it('marks unreferenced files, un-marks revived ones, and collects after the grace period', async () => {
    const project = await projectWithRetention(30)
    const build = await seedBuild(t.db, project.id)
    await seedFile(t.db, { sha256: fakeSha('1') })
    await seedFile(t.db, { sha256: fakeSha('2') })
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: fakeSha('3') })

    const marked = await markUnreferencedFiles(t.db, daysAgo(3))
    expect(marked).toBeGreaterThanOrEqual(2)
    const gc = async (h: string) =>
      (
        await t.db
          .select()
          .from(schema.files)
          .where(eq(schema.files.sha256, fakeSha(h)))
      )[0]?.gcMarkedAt
    expect(await gc('1')).toEqual(daysAgo(3))
    expect(await gc('3')).toBeNull()
    expect(await markUnreferencedFiles(t.db, now)).toBe(0) // already marked

    // File 2 gets referenced again before collection.
    await t.db.insert(schema.uploadClaims).values({ buildId: build.id, fileSha256: fakeSha('2') })
    expect(await unmarkReferencedFiles(t.db)).toBeGreaterThanOrEqual(1)
    expect(await gc('2')).toBeNull()

    const deleted: string[] = []
    const result = await collectMarkedFiles(t.db, {
      now,
      graceMs: DAY,
      deleteObject: (key) => {
        deleted.push(key)
        return Promise.resolve()
      },
    })
    expect(result.deleted).toBeGreaterThanOrEqual(1)
    expect(deleted).toContain(`k/${fakeSha('1')}`)
    expect(deleted).not.toContain(`k/${fakeSha('2')}`)
    expect(await gc('1')).toBeUndefined() // row gone
  })

  it('leaves files marked inside the grace period alone', async () => {
    await seedFile(t.db, { sha256: fakeSha('9') })
    await markUnreferencedFiles(t.db, now)
    const result = await collectMarkedFiles(t.db, {
      now,
      graceMs: DAY,
      deleteObject: () => Promise.reject(new Error('must not delete')),
    })
    expect(result.deleted).toBe(0)
  })
})

describe('storageUsage', () => {
  it('sums verified files by kind and counts those waiting for collection', async () => {
    const fresh = await createTestDb()
    try {
      await seedFile(fresh.db, { sha256: fakeSha('a'), kind: 'screenshot' })
      await seedFile(fresh.db, { sha256: fakeSha('b'), kind: 'screenshot' })
      await seedFile(fresh.db, { sha256: fakeSha('c'), kind: 'diff' })
      await markUnreferencedFiles(fresh.db, now)
      const usage = await storageUsage(fresh.db)
      expect(usage.files.toSorted((x, y) => x.kind.localeCompare(y.kind))).toEqual([
        { kind: 'diff', count: 1, bytes: 1 },
        { kind: 'screenshot', count: 2, bytes: 2 },
      ])
      expect(usage.totalBytes).toBe(3)
      expect(usage.markedForDeletion).toEqual({ count: 3, bytes: 3 })
    } finally {
      await fresh.close()
    }
  })
})

describe('previewCollection', () => {
  it('reports what a collection would delete, and changes nothing', async () => {
    const project = await projectWithRetention(30)
    const build = await seedBuild(t.db, project.id, { branch: 'main' })
    const used = fakeSha('f1')
    const due = fakeSha('f2')
    const recent = fakeSha('f3')
    const fresh = fakeSha('f4')
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: used })
    await Promise.all([due, recent, fresh].map((s) => seedFile(t.db, { sha256: s })))
    await t.db
      .update(schema.files)
      .set({ gcMarkedAt: new Date(now.getTime() - 3 * 3600_000) })
      .where(eq(schema.files.sha256, due))
    await t.db
      .update(schema.files)
      .set({ gcMarkedAt: new Date(now.getTime() - 3600_000 / 2) })
      .where(eq(schema.files.sha256, recent))
    // Marked, but referenced since: not deleted.
    await t.db
      .update(schema.files)
      .set({ gcMarkedAt: new Date(now.getTime() - 5 * 3600_000) })
      .where(eq(schema.files.sha256, used))

    const before = await t.db.select().from(schema.files)
    const preview = await previewCollection(t.db, { now, graceMs: 3600_000, sample: 5 })
    expect(preview.wouldDelete.count).toBe(1)
    expect(preview.wouldDelete.bytes).toBe(1)
    expect(preview.wouldDelete.sampleKeys).toEqual([`k/${due}`])
    // `recent` is marked too recently and `fresh` is not marked: a run marks them (others may exist).
    expect(preview.wouldMark).toBeGreaterThanOrEqual(2)
    expect(await t.db.select().from(schema.files)).toEqual(before)
  })
})
