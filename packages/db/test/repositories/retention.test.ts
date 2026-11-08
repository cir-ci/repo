import {
  createTestDb,
  seedBuild,
  seedFile,
  seedProject,
  seedScreenshot,
  seedSite,
  sha,
  type TestDb,
} from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  collectMarkedFiles,
  expireBuilds,
  expireSites,
  listBuildScreenshots,
  markUnreferencedFiles,
  previewCollection,
  schema,
  storageUsage,
  unmarkReferencedFiles,
} from '#src/index.ts'

let t: TestDb
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
    await seedScreenshot(t.db, { buildId: old.id, fileSha256: sha('a') })
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
  it('drops stale branch addresses and unserved old versions, never the default branch’s', async () => {
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
    await seedFile(t.db, { sha256: sha('1') })
    await seedFile(t.db, { sha256: sha('2') })
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha('3') })

    const marked = await markUnreferencedFiles(t.db, daysAgo(3))
    expect(marked).toBeGreaterThanOrEqual(2)
    const gc = async (h: string) =>
      (
        await t.db
          .select()
          .from(schema.files)
          .where(eq(schema.files.sha256, sha(h)))
      )[0]?.gcMarkedAt
    expect(await gc('1')).toEqual(daysAgo(3))
    expect(await gc('3')).toBeNull()
    expect(await markUnreferencedFiles(t.db, now)).toBe(0) // already marked

    // File 2 gets referenced again before collection.
    await t.db.insert(schema.uploadClaims).values({ buildId: build.id, fileSha256: sha('2') })
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
    expect(deleted).toContain(`k/${sha('1')}`)
    expect(deleted).not.toContain(`k/${sha('2')}`)
    expect(await gc('1')).toBeUndefined() // row gone
  })

  it('leaves files marked inside the grace period alone', async () => {
    await seedFile(t.db, { sha256: sha('9') })
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
      await seedFile(fresh.db, { sha256: sha('a'), kind: 'screenshot' })
      await seedFile(fresh.db, { sha256: sha('b'), kind: 'screenshot' })
      await seedFile(fresh.db, { sha256: sha('c'), kind: 'diff' })
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
    const used = sha('f1')
    const due = sha('f2')
    const recent = sha('f3')
    const fresh = sha('f4')
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
