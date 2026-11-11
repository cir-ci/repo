import {
  createTestDb,
  seedBuild,
  seedDiff,
  seedScreenshot,
  seedSite,
  seedProject,
  seedWorkspace,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getWorkspaceStorage, storageUsage } from '#src/queries/index.ts'
import { createProject, setWorkspaceSettings } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('getWorkspaceStorage', () => {
  it('is empty for a workspace with nothing stored', async () => {
    const { project, workspace } = await seedProject(t.db)
    const usage = await getWorkspaceStorage(t.db, workspace.id)
    expect(usage).toMatchObject({ totalBytes: 0, totalFiles: 0, defaultRetentionDays: 30 })
    expect(usage.kinds.map((k) => [k.kind, k.files, k.bytes])).toEqual([
      ['screenshot', 0, 0],
      ['diff', 0, 0],
      ['thumbnail', 0, 0],
      ['site', 0, 0],
    ])
    expect(usage.projects).toMatchObject([
      { slug: project.slug, files: 0, bytes: 0, retentionDays: 30 },
    ])
  })

  it('counts files of known sizes by kind and by project, once each, and keeps workspaces apart', async () => {
    const first = await seedProject(t.db, { slug: 'web' })
    const { workspace } = first
    const docs = await seedProject(t.db, {
      slug: 'docs',
      workspace: { workspace, owner: first.owner },
    })
    const elsewhere = await seedProject(t.db)

    // web: two builds sharing one screenshot file (100 B), plus a second one (200 B), a
    // thumbnail (10 B) and a diff (50 B).
    const b1 = await seedBuild(t.db, first.project.id)
    const b2 = await seedBuild(t.db, first.project.id)
    await seedScreenshot(t.db, {
      buildId: b1.id,
      name: 'home',
      fileSha256: fakeSha('a'),
      size: 100,
      thumbnailSha256: fakeSha('b'),
      thumbnailSize: 10,
    })
    await seedScreenshot(t.db, {
      buildId: b2.id,
      name: 'home',
      fileSha256: fakeSha('a'),
      size: 100,
    })
    await seedScreenshot(t.db, {
      buildId: b2.id,
      name: 'about',
      fileSha256: fakeSha('c'),
      size: 200,
    })
    await seedDiff(t.db, {
      buildId: b2.id,
      name: 'home',
      diffFileSha256: fakeSha('d'),
      diffFileSize: 50,
    })
    // docs: the same screenshot file as web (shared bytes) and a hosted site of 30 + 70 B.
    const b3 = await seedBuild(t.db, docs.project.id)
    await seedScreenshot(t.db, {
      buildId: b3.id,
      name: 'home',
      fileSha256: fakeSha('a'),
      size: 100,
    })
    await seedSite(t.db, {
      projectId: docs.project.id,
      files: [
        { path: 'index.html', sha256: fakeSha('e'), size: 30 },
        { path: 'app.js', sha256: fakeSha('f'), size: 70 },
      ],
    })
    // Another workspace's files never show up here.
    const b4 = await seedBuild(t.db, elsewhere.project.id)
    await seedScreenshot(t.db, { buildId: b4.id, name: 'x', fileSha256: fakeSha('9'), size: 999 })

    const usage = await getWorkspaceStorage(t.db, workspace.id)
    expect(usage.kinds).toEqual([
      { kind: 'screenshot', files: 2, bytes: 300 },
      { kind: 'diff', files: 1, bytes: 50 },
      { kind: 'thumbnail', files: 1, bytes: 10 },
      { kind: 'site', files: 2, bytes: 100, versions: 1 },
    ])
    // Distinct files overall: a, c, b, d, e, f.
    expect(usage).toMatchObject({ totalFiles: 6, totalBytes: 460 })
    // Per project, the shared file counts for each project that refers to it; biggest first.
    expect(usage.projects.map((p) => [p.slug, p.files, p.bytes])).toEqual([
      ['web', 4, 360],
      ['docs', 3, 200],
    ])
    expect(usage.projects.map((p) => p.retentionDays)).toEqual([30, 30])
    // The instance-wide numbers (the CLI's) still count every verified file, by kind.
    const instance = await storageUsage(t.db)
    expect(instance.totalBytes).toBeGreaterThanOrEqual(999 + 360)
  })

  it("shows each project's retention and the workspace default for new projects", async () => {
    const { workspace } = await seedWorkspace(t.db)
    await setWorkspaceSettings(t.db, workspace.id, { retentionDays: 90 })
    await createProject(t.db, {
      workspaceSlug: workspace.slug,
      name: 'new',
      color: 'olive',
      icon: 'box',
    })
    const usage = await getWorkspaceStorage(t.db, workspace.id)
    expect(usage.defaultRetentionDays).toBe(90)
    expect(usage.projects).toMatchObject([
      { slug: 'new', retentionDays: 90, color: 'olive', icon: 'box' },
    ])
  })
})
