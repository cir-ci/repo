import { countOpenTriage, listTriage, storageUsage } from '@circi/db/queries'
import {
  createBuild,
  ensureAssetFiles,
  markFileVerified,
  planUploads,
  publishSiteVersion,
  refreshTriageProblems,
  updateProjectSettings,
} from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  createTestDb,
  imageSha,
  seedBuild,
  seedDiff,
  seedProject,
  seedUploadClaim,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { completeBuild, finalizeBuild, runRetention } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
// Retention sweeps every build in the database: each test starts from an empty one.
beforeEach(async () => {
  await t.reset()
  deleted.length = 0
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
  const hash = options.hash ?? fakeSha(counter.toString(16))
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

  it("respects each project's own retention period", async () => {
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
    const { collectMarkedFiles } = await import('@circi/db/repositories')
    const result = await collectMarkedFiles(t.db, { now: new Date(), graceMs: DAY, deleteObject })
    expect(result.kept).toBeGreaterThanOrEqual(1)
    expect(
      await t.db.select().from(schema.files).where(eq(schema.files.sha256, old.hash)),
    ).toHaveLength(1)
  })

  it('collects a file that was announced but never uploaded', async () => {
    const { project } = await seedProject(t.db)
    const build = await createBuild(t.db, { projectId: project.id, commitSha: 'ffff0001' })
    const hash = fakeSha('ba')
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
    const hash = fakeSha((counter + 100).toString(16))
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

  it("removes stale branch addresses and old versions, but never the default branch's or a served one", async () => {
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

describe('undo records', () => {
  it('deletes the ones past their window, keeping live ones and used review undos', async () => {
    const { project, owner } = await seedProject(t.db)
    const past = new Date(Date.now() - 60_000)
    const future = new Date(Date.now() + 60_000)
    const row = (kind: schema.UndoKind, expiresAt: Date, usedAt: Date | null) => ({
      userId: owner.id,
      projectId: project.id,
      kind,
      data: {},
      expiresAt,
      usedAt,
    })
    await t.db.insert(schema.undoActions).values([
      row('notice_read', past, null), // expired and unused: gone
      row('notice_read', past, past), // expired and used: gone
      row('build_review', past, null), // expired and unused: gone
      row('build_review', past, past), // used review undo: the build's activity keeps it
      row('notice_read', future, null), // still undoable: kept
    ])
    const result = await retention()
    expect(result.expiredUndoActions).toBe(3)
    const left = await t.db.select().from(schema.undoActions)
    expect(left).toHaveLength(2)
    expect(left.some((r) => r.kind === 'build_review' && r.usedAt !== null)).toBe(true)
    expect(left.some((r) => r.expiresAt > new Date())).toBe(true)
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

const storedKeys = async (projectId: string) =>
  (
    await t.db
      .select()
      .from(schema.triageProblems)
      .where(eq(schema.triageProblems.projectId, projectId))
  )
    .map((r) => `${r.kind}:${r.key}`)
    .toSorted()
const queueKeys = async (projectId: string) =>
  (await listTriage(t.db, { projectId, now: new Date() })).items
    .map((i) => `${i.kind}:${i.key}`)
    .toSorted()
const backdate = (buildIds: string[], days: number) =>
  t.db
    .update(schema.builds)
    .set({ createdAt: ago(days) })
    .where(inArray(schema.builds.id, buildIds))

/** A project whose `home` flips A, B, A, B on the default branch: a flaky item once refreshed. */
async function flakyProject() {
  const seeded = await seedProject(t.db)
  await updateProjectSettings(t.db, seeded.project.id, { flakyAfterChanges: 2 })
  const builds = []
  for (const [i, image] of ['A', 'B', 'A', 'B'].entries()) {
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    const b = await seedBuild(t.db, seeded.project.id, { branch: 'main', status: 'complete' })
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await t.db
      .update(schema.builds)
      .set({ baselineSource: 'cli' })
      .where(eq(schema.builds.id, b.id))
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await seedDiff(t.db, {
      buildId: b.id,
      name: 'home',
      status: i === 2 ? 'unchanged' : 'changed',
      headSha256: imageSha(image),
    })
    builds.push(b)
  }
  return { ...seeded, builds }
}

/** A project whose only default-branch build had no baseline: one `no_baseline` item. */
async function orphanProject() {
  const seeded = await seedProject(t.db)
  const b = await seedBuild(t.db, seeded.project.id, { branch: 'main', status: 'complete' })
  await t.db.update(schema.builds).set({ baselineSource: 'none' }).where(eq(schema.builds.id, b.id))
  await seedDiff(t.db, { buildId: b.id, name: 'pricing', status: 'added' })
  return { ...seeded, build: b }
}

describe('retention and the triage queue', () => {
  it('refreshes the stored triage rows of a project whose flaky or orphan builds expire, so the counts follow', async () => {
    const flaky = await flakyProject()
    const orphan = await orphanProject()
    for (const { project } of [flaky, orphan]) {
      // oxlint-disable-next-line no-await-in-loop -- two projects
      await updateProjectSettings(t.db, project.id, { retentionDays: 7 })
      // oxlint-disable-next-line no-await-in-loop -- two projects
      await refreshTriageProblems(t.db, project.id)
    }
    expect(await storedKeys(flaky.project.id)).toEqual(['flaky:home'])
    expect(await storedKeys(orphan.project.id)).toEqual(['no_baseline:pricing'])
    const open = async () =>
      new Map([
        ...(await countOpenTriage(t.db, { workspaceId: flaky.workspace.id, now: new Date() })),
        ...(await countOpenTriage(t.db, { workspaceId: orphan.workspace.id, now: new Date() })),
      ])
    expect(await open()).toEqual(
      new Map([
        [flaky.project.id, 1],
        [orphan.project.id, 1],
      ]),
    )

    // Nothing is old enough yet: a pass leaves the rows as they are.
    await retention()
    expect(await storedKeys(flaky.project.id)).toEqual(['flaky:home'])

    // The history ages out: every build of both projects is past its 7 days.
    await backdate([...flaky.builds.map((b) => b.id), orphan.build.id], 30)
    const result = await retention()
    expect(result.expiredBuilds).toBe(5)

    // The rows follow the queue the builds now make (none), and the sidebar's counts with them.
    for (const { project } of [flaky, orphan]) {
      // oxlint-disable-next-line no-await-in-loop -- two projects
      expect(await queueKeys(project.id)).toEqual([])
      // oxlint-disable-next-line no-await-in-loop -- two projects
      expect(await storedKeys(project.id)).toEqual([])
    }
    expect([...(await open()).values()].every((n) => n === 0)).toBe(true)
  })

  it('leaves the stored rows equal to the queue when only part of a flaky history expires', async () => {
    const flaky = await flakyProject()
    await updateProjectSettings(t.db, flaky.project.id, { retentionDays: 7 })
    await refreshTriageProblems(t.db, flaky.project.id)
    expect(await storedKeys(flaky.project.id)).toEqual(['flaky:home'])
    // The two oldest builds expire; the two newest stay.
    await backdate(
      flaky.builds.slice(0, 2).map((b) => b.id),
      30,
    )
    const result = await retention()
    expect(result.expiredBuilds).toBe(2)
    // Whatever the shorter history says, the stored rows say the same.
    expect(await storedKeys(flaky.project.id)).toEqual(await queueKeys(flaky.project.id))
    const counted = (
      await countOpenTriage(t.db, { workspaceId: flaky.workspace.id, now: new Date() })
    ).get(flaky.project.id)
    expect(counted ?? 0).toBe((await queueKeys(flaky.project.id)).length)
  })
})
