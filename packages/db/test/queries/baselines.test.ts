import {
  createTestDb,
  seedBuild,
  seedProject,
  seedReview,
  seedScreenshot,
  sha,
  type TestDb,
} from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listBaselines } from '#src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (iso: string) => new Date(iso)

describe('listBaselines', () => {
  it('takes, per screenshot name, the newest eligible default-branch build', async () => {
    const { project, owner } = await seedProject(t.db)
    const done = { status: 'complete', conclusion: 'changes_detected' } as const

    // #1 approved: home (a), about (b).
    const b1 = await seedBuild(t.db, project.id, {
      ...done,
      branch: 'main',
      reviewStatus: 'approved',
      createdAt: at('2026-03-01T10:00:00Z'),
      completedAt: at('2026-03-01T10:05:00Z'),
    })
    await seedReview(t.db, {
      buildId: b1.id,
      userId: owner.id,
      createdAt: at('2026-03-01T11:00:00Z'),
    })
    await seedScreenshot(t.db, {
      buildId: b1.id,
      name: 'home',
      fileSha256: sha('a'),
      size: 100,
      width: 1280,
      height: 800,
    })
    await seedScreenshot(t.db, { buildId: b1.id, name: 'about', fileSha256: sha('b'), size: 90 })

    // #2 approved later: replaces home only.
    const b2 = await seedBuild(t.db, project.id, {
      ...done,
      branch: 'main',
      reviewStatus: 'approved',
      createdAt: at('2026-03-02T10:00:00Z'),
      completedAt: at('2026-03-02T10:05:00Z'),
    })
    await seedReview(t.db, {
      buildId: b2.id,
      userId: owner.id,
      createdAt: at('2026-03-02T12:00:00Z'),
    })
    await seedScreenshot(t.db, {
      buildId: b2.id,
      name: 'home',
      fileSha256: sha('c'),
      size: 200,
      width: 1280,
      height: 820,
    })

    // #3 still waiting for review, and #4 on a branch: neither is a baseline.
    const b3 = await seedBuild(t.db, project.id, {
      ...done,
      branch: 'main',
      createdAt: at('2026-03-03T10:00:00Z'),
    })
    await seedScreenshot(t.db, { buildId: b3.id, name: 'home', fileSha256: sha('d') })
    const b4 = await seedBuild(t.db, project.id, {
      ...done,
      branch: 'feature/x',
      reviewStatus: 'approved',
      createdAt: at('2026-03-04T10:00:00Z'),
    })
    await seedScreenshot(t.db, { buildId: b4.id, name: 'home', fileSha256: sha('e') })

    // #5 had no changes and needed no approval: eligible, dated by when it finished.
    const b5 = await seedBuild(t.db, project.id, {
      status: 'complete',
      conclusion: 'no_changes',
      branch: 'main',
      createdAt: at('2026-03-05T10:00:00Z'),
      completedAt: at('2026-03-05T10:05:00Z'),
    })
    await seedScreenshot(t.db, { buildId: b5.id, name: 'contact', fileSha256: sha('f'), size: 70 })

    // #6 is another build name (mobile): its own baseline for the same screenshot name.
    const b6 = await seedBuild(t.db, project.id, {
      ...done,
      name: 'mobile',
      branch: 'main',
      reviewStatus: 'approved',
      createdAt: at('2026-03-06T10:00:00Z'),
      completedAt: at('2026-03-06T10:05:00Z'),
    })
    await seedReview(t.db, {
      buildId: b6.id,
      userId: owner.id,
      createdAt: at('2026-03-06T13:00:00Z'),
    })
    await seedScreenshot(t.db, { buildId: b6.id, name: 'home', fileSha256: sha('9'), size: 50 })

    const items = await listBaselines(t.db, { projectId: project.id, defaultBranch: 'main' })
    expect(
      items.map((i) => [
        i.buildName,
        i.name,
        i.buildNumber,
        i.sizeBytes,
        i.width,
        i.approvedAt.toISOString(),
      ]),
    ).toEqual([
      ['default', 'about', 1, 90, null, '2026-03-01T11:00:00.000Z'],
      ['default', 'contact', 5, 70, null, '2026-03-05T10:05:00.000Z'],
      ['default', 'home', 2, 200, 1280, '2026-03-02T12:00:00.000Z'],
      ['mobile', 'home', 6, 50, null, '2026-03-06T13:00:00.000Z'],
    ])
    expect(items[2]).toMatchObject({ fileSha256: sha('c'), height: 820 })
  })

  it('is empty for a project without an approved default-branch build', async () => {
    const { project } = await seedProject(t.db)
    await seedBuild(t.db, project.id, { branch: 'main', status: 'complete' })
    expect(await listBaselines(t.db, { projectId: project.id, defaultBranch: 'main' })).toEqual([])
  })
})
