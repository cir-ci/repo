import {
  createTestDb,
  seedBuild,
  seedDiff,
  seedFile,
  seedTeam,
  seedScreenshot,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  listBuildDiffs,
  listBuildScreenshots,
  replaceBuildDiffs,
  setScreenshotThumbnail,
  updateDiff,
} from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function newBuild() {
  const { team } = await seedTeam(t.db)
  return seedBuild(t.db, team.id)
}

describe('screenshots', () => {
  it('lists a build’s screenshots and records a thumbnail', async () => {
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

describe('diffs', () => {
  it('replaces a build’s diffs without touching other builds', async () => {
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

  it('updates the result fields of one diff', async () => {
    const build = await newBuild()
    const diff = await seedDiff(t.db, { buildId: build.id, status: 'unchanged' })
    await seedFile(t.db, { sha256: fakeSha('4'), kind: 'diff' })
    await updateDiff(t.db, diff.id, {
      status: 'changed',
      score: 0.25,
      changedPixels: 12,
      sizeChanged: true,
      diffFileSha256: fakeSha('4'),
    })
    const [row] = await listBuildDiffs(t.db, build.id)
    expect(row).toMatchObject({
      status: 'changed',
      score: 0.25,
      changedPixels: 12,
      sizeChanged: true,
      diffFileSha256: fakeSha('4'),
    })
  })
})
