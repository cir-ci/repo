import {
  createTestDb,
  seedBuild,
  seedDiff,
  seedTeam,
  seedScreenshot,
  seedUser,
  sha,
} from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { canUserAccessFile } from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function buildWithScreenshot(teamId: string, fileSha: string, thumbSha?: string) {
  const build = await seedBuild(t.db, teamId)
  await seedScreenshot(t.db, {
    buildId: build.id,
    fileSha256: fileSha,
    ...(thumbSha ? { thumbnailSha256: thumbSha } : {}),
  })
  return build
}

describe('canUserAccessFile (files are shared by hash, so knowing a hash proves nothing)', () => {
  it('allows members of the build’s workspace, and nobody else', async () => {
    const { team, owner } = await seedTeam(t.db)
    await buildWithScreenshot(team.id, sha('a'), sha('b'))
    const outsider = await seedUser(t.db)

    expect(await canUserAccessFile(t.db, owner.id, sha('a'))).toBe(true)
    expect(await canUserAccessFile(t.db, owner.id, sha('b'))).toBe(true) // its thumbnail
    expect(await canUserAccessFile(t.db, outsider.id, sha('a'))).toBe(false)
    expect(await canUserAccessFile(t.db, owner.id, sha('c'))).toBe(false) // unknown hash
  })

  it('still protects a file two workspaces happen to share', async () => {
    const a = await seedTeam(t.db)
    const b = await seedTeam(t.db)
    await buildWithScreenshot(a.team.id, sha('d'))
    // The same bytes uploaded by workspace B are one row in `files`; B's build references it too.
    const bBuild = await seedBuild(t.db, b.team.id)
    await seedScreenshot(t.db, { buildId: bBuild.id, name: 'x', fileSha256: sha('d') })
    expect(await canUserAccessFile(t.db, a.owner.id, sha('d'))).toBe(true)
    expect(await canUserAccessFile(t.db, b.owner.id, sha('d'))).toBe(true)

    const c = await seedTeam(t.db)
    expect(await canUserAccessFile(t.db, c.owner.id, sha('d'))).toBe(false)
  })

  it('covers diff images', async () => {
    const { team, owner } = await seedTeam(t.db)
    const build = await buildWithScreenshot(team.id, sha('e'))
    await seedDiff(t.db, { buildId: build.id, diffFileSha256: sha('f') })
    expect(await canUserAccessFile(t.db, owner.id, sha('f'))).toBe(true)
    expect(await canUserAccessFile(t.db, (await seedUser(t.db)).id, sha('f'))).toBe(false)
  })
})
