import { createTestDb, seedTeam, fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createBuild, markFileVerified, planUploads } from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const keyFor = (s: string) => `${s.slice(0, 2)}/${s}/gen`
const png = (s: string) => ({ sha256: s, size: 10, contentType: 'image/png' })

async function newBuild(overrides: Partial<Parameters<typeof createBuild>[1]> = {}) {
  const { team } = await seedTeam(t.db)
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    ...overrides,
  })
  return { team, build }
}

describe('planUploads (verify before dedup)', () => {
  it('asks for every unknown file and creates pending rows', async () => {
    const { build } = await newBuild()
    const planned = await planUploads(t.db, {
      buildId: build.id,
      kind: 'screenshot',
      files: [png(fakeSha('1')), png(fakeSha('2')), png(fakeSha('1'))],
      storageKeyFor: keyFor,
    })
    expect(planned.map((p) => p.sha256).toSorted()).toEqual([fakeSha('1'), fakeSha('2')])
    const [row] = await t.db
      .select()
      .from(schema.files)
      .where(eq(schema.files.sha256, fakeSha('1')))
    expect(row).toMatchObject({ status: 'pending', storageKey: keyFor(fakeSha('1')) })
  })

  it('never deduplicates against a pending file', async () => {
    const first = await newBuild()
    await planUploads(t.db, {
      buildId: first.build.id,
      kind: 'screenshot',
      files: [png(fakeSha('3'))],
      storageKeyFor: keyFor,
    })
    const second = await newBuild()
    const planned = await planUploads(t.db, {
      buildId: second.build.id,
      kind: 'screenshot',
      files: [png(fakeSha('3'))],
      storageKeyFor: keyFor,
    })
    expect(planned.map((p) => p.sha256)).toEqual([fakeSha('3')])
  })

  it('deduplicates verified files and records an upload claim for them', async () => {
    const first = await newBuild()
    await planUploads(t.db, {
      buildId: first.build.id,
      kind: 'screenshot',
      files: [png(fakeSha('4'))],
      storageKeyFor: keyFor,
    })
    await markFileVerified(t.db, fakeSha('4'), { size: 10 })

    const second = await newBuild()
    const planned = await planUploads(t.db, {
      buildId: second.build.id,
      kind: 'screenshot',
      files: [png(fakeSha('4'))],
      storageKeyFor: keyFor,
    })
    expect(planned).toEqual([])
    const claims = await t.db
      .select()
      .from(schema.uploadClaims)
      .where(eq(schema.uploadClaims.buildId, second.build.id))
    expect(claims.map((c) => c.fileSha256)).toEqual([fakeSha('4')])
  })

  it('rejects malformed hashes', async () => {
    const { build } = await newBuild()
    await expect(
      planUploads(t.db, {
        buildId: build.id,
        kind: 'screenshot',
        files: [png('nope')],
        storageKeyFor: keyFor,
      }),
    ).rejects.toThrow(/Invalid sha256/)
  })
})
