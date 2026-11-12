import {
  createTestDb,
  seedBuild,
  seedDiff,
  seedFile,
  seedProject,
  seedScreenshot,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  listBuildDiffs,
  copyFileThumbnailsToScreenshots,
  listBuildScreenshots,
  replaceBuildDiffs,
  setScreenshotThumbnail,
  updateDiffs,
} from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function newBuild() {
  const { project } = await seedProject(t.db)
  return seedBuild(t.db, project.id)
}

describe('screenshots', () => {
  it("lists a build's screenshots and records a thumbnail", async () => {
    const build = await newBuild()
    const other = await newBuild()
    const shot = await seedScreenshot(t.db, { buildId: build.id, fileSha256: fakeSha('1') })
    await seedScreenshot(t.db, { buildId: other.id, fileSha256: fakeSha('2') })
    await seedFile(t.db, { sha256: fakeSha('3'), kind: 'thumbnail' })

    await setScreenshotThumbnail(t.db, shot.id, fakeSha('3'))
    const listed = await listBuildScreenshots(t.db, build.id)
    expect(listed.map((s) => [s.id, s.thumbnailSha256])).toEqual([[shot.id, fakeSha('3')]])
  })
})

describe('file thumbnails', () => {
  it('copies a file thumbnail to the screenshots that use the file, in one statement', async () => {
    const build = await newBuild()
    const withThumb = await seedScreenshot(t.db, {
      buildId: build.id,
      name: 'one',
      fileSha256: fakeSha('5'),
    })
    const twin = await seedScreenshot(t.db, {
      buildId: build.id,
      name: 'two',
      fileSha256: fakeSha('5'),
    })
    const without = await seedScreenshot(t.db, {
      buildId: build.id,
      name: 'three',
      fileSha256: fakeSha('6'),
    })
    await seedFile(t.db, { sha256: fakeSha('7'), kind: 'thumbnail' })
    await t.db
      .update(schema.files)
      .set({ thumbnailSha256: fakeSha('7') })
      .where(eq(schema.files.sha256, fakeSha('5')))

    await copyFileThumbnailsToScreenshots(t.db, build.id)
    const byId = new Map((await listBuildScreenshots(t.db, build.id)).map((s) => [s.id, s]))
    expect(byId.get(withThumb.id)?.thumbnailSha256).toBe(fakeSha('7'))
    expect(byId.get(twin.id)?.thumbnailSha256).toBe(fakeSha('7'))
    expect(byId.get(without.id)?.thumbnailSha256).toBeNull()
  })
})

describe('diffs', () => {
  it('inserts and updates more than 10,000 diffs, past the parameter limit of one statement', async () => {
    const build = await newBuild()
    const count = 12_000
    const rows = Array.from({ length: count }, (_, i) => ({
      buildId: build.id,
      name: `shot-${i}`,
      status: null,
      jobStatus: 'pending' as const,
    }))
    await replaceBuildDiffs(t.db, build.id, rows)
    const listed = await listBuildDiffs(t.db, build.id)
    expect(listed).toHaveLength(count)

    await updateDiffs(
      t.db,
      listed.map((d, i) => ({
        id: d.id,
        status: i % 2 === 0 ? ('changed' as const) : ('unchanged' as const),
        score: i % 2 === 0 ? 0.5 : 0,
        changedPixels: i % 2 === 0 ? 7 : null,
        ignoredChangedPixels: 0,
        ignoredRegions: i % 3 === 0 ? [`${d.name} #1`, `${d.name} #2`] : [],
        sizeChanged: false,
        diffFileSha256: null,
        jobStatus: 'done' as const,
        errorMessage: null,
      })),
    )
    const after = await listBuildDiffs(t.db, build.id)
    expect(after.every((d) => d.jobStatus === 'done')).toBe(true)
    expect(after.filter((d) => d.status === 'changed')).toHaveLength(count / 2)
    const sample = after.find((d) => d.name === 'shot-3')
    expect(sample).toMatchObject({
      status: 'unchanged',
      ignoredRegions: ['shot-3 #1', 'shot-3 #2'],
      changedPixels: null,
    })
  })

  it("replaces a build's diffs without touching other builds", async () => {
    const build = await newBuild()
    const other = await newBuild()
    await seedDiff(t.db, { buildId: build.id, name: 'old' })
    await seedDiff(t.db, { buildId: other.id, name: 'keep' })

    await replaceBuildDiffs(t.db, build.id, [
      { buildId: build.id, name: 'a', status: 'added' },
      { buildId: build.id, name: 'b', status: 'changed' },
    ])
    expect((await listBuildDiffs(t.db, build.id)).map((d) => d.name).toSorted()).toEqual(['a', 'b'])
    expect((await listBuildDiffs(t.db, other.id)).map((d) => d.name)).toEqual(['keep'])

    await replaceBuildDiffs(t.db, build.id, [])
    expect(await listBuildDiffs(t.db, build.id)).toEqual([])
  })

  it('updates the result fields of a diff', async () => {
    const build = await newBuild()
    const diff = await seedDiff(t.db, { buildId: build.id, status: 'unchanged' })
    await seedFile(t.db, { sha256: fakeSha('4'), kind: 'diff' })
    await updateDiffs(t.db, [
      {
        id: diff.id,
        status: 'changed',
        score: 0.25,
        changedPixels: 12,
        ignoredChangedPixels: 3,
        ignoredRegions: [],
        sizeChanged: true,
        diffFileSha256: fakeSha('4'),
        jobStatus: 'done',
        errorMessage: null,
      },
    ])
    const [row] = await listBuildDiffs(t.db, build.id)
    expect(row).toMatchObject({
      status: 'changed',
      score: 0.25,
      changedPixels: 12,
      ignoredChangedPixels: 3,
      sizeChanged: true,
      diffFileSha256: fakeSha('4'),
    })
  })
})
