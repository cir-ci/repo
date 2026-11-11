import {
  createTestDb,
  seedBuild,
  seedDiff,
  seedProject,
  seedScreenshot,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { canUserAccessFile } from '#src/queries/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function buildWithScreenshot(projectId: string, fileSha: string, thumbSha?: string) {
  const build = await seedBuild(t.db, projectId)
  await seedScreenshot(t.db, {
    buildId: build.id,
    fileSha256: fileSha,
    ...(thumbSha ? { thumbnailSha256: thumbSha } : {}),
  })
  return build
}

describe('canUserAccessFile (files are shared by hash, so knowing a hash proves nothing)', () => {
  it("allows members of the build's workspace, and nobody else", async () => {
    const { project, owner } = await seedProject(t.db)
    await buildWithScreenshot(project.id, fakeSha('a'), fakeSha('b'))
    const outsider = await seedUser(t.db)

    expect(await canUserAccessFile(t.db, owner.id, fakeSha('a'))).toBe(true)
    expect(await canUserAccessFile(t.db, owner.id, fakeSha('b'))).toBe(true) // its thumbnail
    expect(await canUserAccessFile(t.db, outsider.id, fakeSha('a'))).toBe(false)
    expect(await canUserAccessFile(t.db, owner.id, fakeSha('c'))).toBe(false) // unknown hash
  })

  it('still protects a file two workspaces happen to share', async () => {
    const a = await seedProject(t.db)
    const b = await seedProject(t.db)
    await buildWithScreenshot(a.project.id, fakeSha('d'))
    // The same bytes uploaded by workspace B are one row in `files`; B's build references it too.
    const bBuild = await seedBuild(t.db, b.project.id)
    await seedScreenshot(t.db, { buildId: bBuild.id, name: 'x', fileSha256: fakeSha('d') })
    expect(await canUserAccessFile(t.db, a.owner.id, fakeSha('d'))).toBe(true)
    expect(await canUserAccessFile(t.db, b.owner.id, fakeSha('d'))).toBe(true)

    const c = await seedProject(t.db)
    expect(await canUserAccessFile(t.db, c.owner.id, fakeSha('d'))).toBe(false)
  })

  it('covers diff images', async () => {
    const { project, owner } = await seedProject(t.db)
    const build = await buildWithScreenshot(project.id, fakeSha('e'))
    await seedDiff(t.db, { buildId: build.id, diffFileSha256: fakeSha('f') })
    expect(await canUserAccessFile(t.db, owner.id, fakeSha('f'))).toBe(true)
    expect(await canUserAccessFile(t.db, (await seedUser(t.db)).id, fakeSha('f'))).toBe(false)
  })
})
