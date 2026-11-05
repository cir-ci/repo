import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  canUserAccessFile,
  createBuild,
  listProjectsOverview,
  schema,
  upsertServerFile,
} from '../../src/index.ts'
import { addTestMember, createTestDb, seedProject, seedUser, sha, type TestDb } from '../helpers.ts'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('listProjectsOverview', () => {
  it('lists only projects in organizations the user belongs to', async () => {
    const mine = await seedProject(t.db)
    const theirs = await seedProject(t.db)
    const shared = await seedProject(t.db)
    await addTestMember(t.db, { orgId: shared.org.id, userId: mine.owner.id })

    const slugs = (await listProjectsOverview(t.db, mine.owner.id)).map((p) => p.org.slug)
    expect(slugs.toSorted()).toEqual([mine.org.slug, shared.org.slug].toSorted())
    expect(slugs).not.toContain(theirs.org.slug)
  })

  it('is empty for a user without organizations', async () => {
    expect(await listProjectsOverview(t.db, (await seedUser(t.db)).id)).toEqual([])
  })
})

async function buildWithScreenshot(projectId: string, fileSha: string, thumbSha?: string) {
  const build = await createBuild(t.db, { projectId, commitSha: 'abc1234' })
  for (const [i, s] of [fileSha, thumbSha].entries()) {
    if (!s) continue
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await upsertServerFile(t.db, {
      sha256: s,
      storageKey: `k/${s}`,
      kind: i === 0 ? 'screenshot' : 'thumbnail',
      size: 1,
      contentType: 'image/png',
    })
  }
  await t.db.insert(schema.screenshots).values({
    buildId: build.id,
    name: 'home',
    fileSha256: fileSha,
    ...(thumbSha ? { thumbnailSha256: thumbSha } : {}),
  })
  return build
}

describe('canUserAccessFile (files are shared by hash, so knowing a hash proves nothing)', () => {
  it('allows members of the build’s organization, and nobody else', async () => {
    const { project, owner } = await seedProject(t.db)
    await buildWithScreenshot(project.id, sha('a'), sha('b'))
    const outsider = await seedUser(t.db)

    expect(await canUserAccessFile(t.db, owner.id, sha('a'))).toBe(true)
    expect(await canUserAccessFile(t.db, owner.id, sha('b'))).toBe(true) // its thumbnail
    expect(await canUserAccessFile(t.db, outsider.id, sha('a'))).toBe(false)
    expect(await canUserAccessFile(t.db, owner.id, sha('c'))).toBe(false) // unknown hash
  })

  it('still protects a file two organizations happen to share', async () => {
    const a = await seedProject(t.db)
    const b = await seedProject(t.db)
    await buildWithScreenshot(a.project.id, sha('d'))
    // The same bytes uploaded by org B are one row in `files`; B's build references it too.
    const bBuild = await createBuild(t.db, { projectId: b.project.id, commitSha: 'abc1234' })
    await t.db
      .insert(schema.screenshots)
      .values({ buildId: bBuild.id, name: 'x', fileSha256: sha('d') })
    expect(await canUserAccessFile(t.db, a.owner.id, sha('d'))).toBe(true)
    expect(await canUserAccessFile(t.db, b.owner.id, sha('d'))).toBe(true)

    const c = await seedProject(t.db)
    expect(await canUserAccessFile(t.db, c.owner.id, sha('d'))).toBe(false)
  })

  it('covers diff images', async () => {
    const { project, owner } = await seedProject(t.db)
    const build = await buildWithScreenshot(project.id, sha('e'))
    await upsertServerFile(t.db, {
      sha256: sha('f'),
      storageKey: 'k/f',
      kind: 'diff',
      size: 1,
      contentType: 'image/png',
    })
    await t.db
      .insert(schema.screenshotDiffs)
      .values({ buildId: build.id, name: 'home', diffFileSha256: sha('f') })
    expect(await canUserAccessFile(t.db, owner.id, sha('f'))).toBe(true)
    expect(await canUserAccessFile(t.db, (await seedUser(t.db)).id, sha('f'))).toBe(false)
  })
})
