import {
  createBuild,
  ensureAssetFiles,
  markFileVerified,
  planUploads,
  publishSiteVersion,
  schema,
  storageUsage,
} from '@circi/db'
import { createTestDb, seedProject, seedUploadClaim, sha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { completeBuild, finalizeBuild, runRetention } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
const deleted: string[] = []
const deleteObject = async (key: string) => void deleted.push(key)
const retention = (over: { now?: Date; graceMs?: number } = {}) =>
  runRetention(t.db, { deleteObject, ...over })

let counter = 0
/** A completed build with one screenshot, created `days` ago. */
async function oldBuild(
  project: { id: string },
  options: { days: number; branch?: string; hash?: string; approved?: boolean },
) {
  counter += 1
  const hash = options.hash ?? sha(counter.toString(16))
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: `abc${counter.toString().padStart(4, '0')}0`,
    branch: options.branch ?? 'feature',
  })
  await planUploads(t.db, {
    buildId: build.id,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 100, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}/${counter}`,
  })
  await markFileVerified(t.db, hash, { size: 100 })
  await finalizeBuild(t.db, { buildId: build.id, screenshots: [{ name: 'home', sha256: hash }] })
  await completeBuild(
    t.db,
    { ...build, status: 'processing' },
    {
      conclusion: 'no_changes',
      approval: options.approved ? 'default-branch' : 'none',
    },
  )
  await t.db
    .update(schema.builds)
    .set({ createdAt: ago(options.days) })
    .where(eq(schema.builds.id, build.id))
  return { build, hash }
}

const statusOf = async (id: string) =>
  (await t.db.select().from(schema.builds).where(eq(schema.builds.id, id)))[0]?.status

describe('expiring builds', () => {
  it('expires builds past retention, drops their screenshots, and keeps recent ones', async () => {
    const { project } = await seedProject(t.db)
    const old = await oldBuild(project, { days: 40 })
    const recent = await oldBuild(project, { days: 5 })
    const result = await retention()
    expect(result.expiredBuilds).toBeGreaterThanOrEqual(1)
    expect(await statusOf(old.build.id)).toBe('expired')
    expect(await statusOf(recent.build.id)).toBe('complete')
    const shots = await t.db
      .select()
      .from(schema.screenshots)
      .where(eq(schema.screenshots.buildId, old.build.id))
    expect(shots).toEqual([])
  })

  it('never expires the newest baseline on the default branch, however old', async () => {
    const { project } = await seedProject(t.db)
    const oldest = await oldBuild(project, { days: 100, branch: 'main', approved: true })
    const newer = await oldBuild(project, { days: 60, branch: 'main', approved: true })
    await retention()
    expect(await statusOf(newer.build.id)).toBe('complete') // the baseline later builds compare to
    expect(await statusOf(oldest.build.id)).toBe('expired')
  })

  it('respects each project’s own retention period', async () => {
    const { project } = await seedProject(t.db)
    await t.db
      .update(schema.projects)
      .set({ retentionDays: 90 })
      .where(eq(schema.projects.id, project.id))
    const build = await oldBuild(project, { days: 60 })
    await retention()
    expect(await statusOf(build.build.id)).toBe('complete')
  })
})

describe('collecting files', () => {
  it('marks unreferenced files, waits out the grace period, then deletes them and their objects', async () => {
    const { project } = await seedProject(t.db)
    const gone = await oldBuild(project, { days: 40 })
    deleted.length = 0

    const first = await retention()
    expect(first.marked).toBeGreaterThanOrEqual(1)
    expect(first.deleted).toBe(0) // marked just now: inside the grace period
    const [marked] = await t.db
      .select()
      .from(schema.files)
      .where(eq(schema.files.sha256, gone.hash))
    expect(marked?.gcMarkedAt).not.toBeNull()

    const later = await retention({ now: new Date(Date.now() + 2 * DAY) })
    expect(later.deleted).toBeGreaterThanOrEqual(1)
    expect(
      await t.db.select().from(schema.files).where(eq(schema.files.sha256, gone.hash)),
    ).toEqual([])
    expect(deleted.some((k) => k.includes(gone.hash))).toBe(true)
  })

  it('never marks a file something still points at', async () => {
    const { project } = await seedProject(t.db)
    const live = await oldBuild(project, { days: 1 })
    await retention({ now: new Date(Date.now() + 10 * DAY), graceMs: 0 })
    const [row] = await t.db.select().from(schema.files).where(eq(schema.files.sha256, live.hash))
    expect(row?.gcMarkedAt ?? null).toBeNull()
  })

  it('keeps a marked file that a build started using during the grace period', async () => {
    const { project } = await seedProject(t.db)
    const old = await oldBuild(project, { days: 40 })
    await retention() // expires the build, marks its now-unreferenced file
    const [marked] = await t.db.select().from(schema.files).where(eq(schema.files.sha256, old.hash))
    expect(marked?.gcMarkedAt).not.toBeNull()

    // A new build is told "we already have that file": it claims it. Dedup racing the collector.
    const fresh = await createBuild(t.db, { projectId: project.id, commitSha: 'dddd0001' })
    const planned = await planUploads(t.db, {
      buildId: fresh.id,
      kind: 'screenshot',
      files: [{ sha256: old.hash, size: 100, contentType: 'image/png' }],
      storageKeyFor: (s) => `files/${s}/x`,
    })
    expect(planned).toEqual([]) // nothing to upload: the server still has it

    deleted.length = 0
    const result = await retention({ now: new Date(Date.now() + 3 * DAY) })
    expect(result.deleted).toBe(0)
    expect(deleted).toEqual([])
    const [after] = await t.db.select().from(schema.files).where(eq(schema.files.sha256, old.hash))
    expect(after).toBeDefined()
    expect(after?.gcMarkedAt ?? null).toBeNull() // un-marked: referenced again
  })

  it('treats a claim made between marking and collecting as a reference (the re-check)', async () => {
    const { project } = await seedProject(t.db)
    const old = await oldBuild(project, { days: 40 })
    await retention()
    // Marked long ago as far as the collector is concerned, but claimed just before it runs.
    await t.db
      .update(schema.files)
      .set({ gcMarkedAt: ago(5) })
      .where(eq(schema.files.sha256, old.hash))
    const fresh = await createBuild(t.db, { projectId: project.id, commitSha: 'eeee0001' })
    await seedUploadClaim(t.db, { buildId: fresh.id, fileSha256: old.hash })
    const { collectMarkedFiles } = await import('@circi/db')
    const result = await collectMarkedFiles(t.db, { now: new Date(), graceMs: DAY, deleteObject })
    expect(result.kept).toBeGreaterThanOrEqual(1)
    expect(
      await t.db.select().from(schema.files).where(eq(schema.files.sha256, old.hash)),
    ).toHaveLength(1)
  })

  it('collects a file that was announced but never uploaded', async () => {
    const { project } = await seedProject(t.db)
    const build = await createBuild(t.db, { projectId: project.id, commitSha: 'ffff0001' })
    const hash = sha('ba')
    await planUploads(t.db, {
      buildId: build.id,
      kind: 'screenshot',
      files: [{ sha256: hash, size: 10, contentType: 'image/png' }],
      storageKeyFor: (s) => `files/${s}/never`,
    })
    await t.db.delete(schema.uploadClaims).where(eq(schema.uploadClaims.buildId, build.id))
    await retention()
    const result = await retention({ now: new Date(Date.now() + 3 * DAY) })
    expect(result.deleted).toBeGreaterThanOrEqual(1)
    expect(await t.db.select().from(schema.files).where(eq(schema.files.sha256, hash))).toEqual([])
  })
})

describe('expiring sites', () => {
  const addressing = {
    chooseSlug: () => `slug-${counter}`,
    commitLabel: (slug: string) => `${'a'.repeat(12)}-${slug}`.slice(0, 63),
    branchLabel: (branch: string, slug: string) =>
      `${branch.padEnd(12, '0').slice(0, 12)}-${slug}`.replace(/[^a-z0-9-]/g, 'x'),
  }

  async function site(
    projectId: string,
    input: { commit: string; branch: string; move: boolean; label: string },
  ) {
    counter += 1
    const hash = sha((counter + 100).toString(16))
    await ensureAssetFiles(t.db, [
      { sha256: hash, size: 5, storageKey: `files/${hash}/s`, contentType: 'text/html' },
    ])
    return publishSiteVersion(t.db, {
      projectId,
      name: `s${counter}`,
      kind: 'generic',
      spa: false,
      commitSha: input.commit.padEnd(40, '0'),
      branch: input.branch,
      moveBranch: input.move,
      entryPath: 'index.html',
      files: [{ path: 'index.html', sha256: hash, size: 5, contentType: 'text/html' }],
      slugPrefix: 'slug',
      addressing: {
        ...addressing,
        commitLabel: () => `${input.commit.padEnd(12, '0').slice(0, 12)}-${input.label}`,
        branchLabel: () => `${input.label}-branch`.slice(0, 63),
      },
    })
  }

  it('removes stale branch addresses and old versions, but never the default branch’s or a served one', async () => {
    const { project } = await seedProject(t.db)
    const stale = await site(project.id, {
      commit: 'a1',
      branch: 'feature/old',
      move: true,
      label: 'stale',
    })
    const main = await site(project.id, { commit: 'b2', branch: 'main', move: true, label: 'main' })
    const fresh = await site(project.id, {
      commit: 'c3',
      branch: 'feature/new',
      move: true,
      label: 'fresh',
    })
    const longAgo = ago(60)
    await t.db
      .update(schema.siteHostnames)
      .set({ updatedAt: longAgo })
      .where(eq(schema.siteHostnames.projectSiteId, stale.site.id))
    await t.db
      .update(schema.siteHostnames)
      .set({ updatedAt: longAgo })
      .where(eq(schema.siteHostnames.projectSiteId, main.site.id))
    await t.db.update(schema.staticSites).set({ createdAt: longAgo })

    const result = await retention()
    expect(result.expiredSites.addresses).toBeGreaterThanOrEqual(1)

    const labels = (await t.db.select().from(schema.siteHostnames)).map((h) => h.label)
    expect(labels).toContain('main-branch') // the default branch's address never expires
    expect(labels).not.toContain('stale-branch')
    // The stale site's version is old and no longer served by a branch address: gone.
    const versions = await t.db.select().from(schema.staticSites)
    const ids = new Set(versions.map((v) => v.id))
    expect(ids.has(stale.version.id)).toBe(false)
    expect(ids.has(main.version.id)).toBe(true) // still served by main's address
    // Old by creation, but a live branch address still serves it: never deleted.
    expect(ids.has(fresh.version.id)).toBe(true)
  })
})

describe('storage usage', () => {
  it('totals what is stored by kind, and what waits to be collected', async () => {
    const { project } = await seedProject(t.db)
    await oldBuild(project, { days: 1 })
    const usage = await storageUsage(t.db)
    expect(usage.files.find((f) => f.kind === 'screenshot')?.count).toBeGreaterThanOrEqual(1)
    expect(usage.totalBytes).toBeGreaterThan(0)
    expect(usage.markedForDeletion.count).toBeGreaterThanOrEqual(0)
  })
})
