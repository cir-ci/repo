import { createTestDb, seedUser, type TestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { countUsers, isInstanceAdmin, schema } from '#src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('countUsers', () => {
  it('counts every user', async () => {
    const before = await countUsers(t.db)
    await seedUser(t.db)
    await seedUser(t.db)
    expect(await countUsers(t.db)).toBe(before + 2)
  })
})

describe('isInstanceAdmin', () => {
  it('is true only for a user whose role list includes admin', async () => {
    const plain = await seedUser(t.db)
    const admin = await seedUser(t.db)
    const both = await seedUser(t.db)
    await t.db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, admin.id))
    await t.db.update(schema.user).set({ role: 'user,admin' }).where(eq(schema.user.id, both.id))
    expect(await isInstanceAdmin(t.db, plain.id)).toBe(false)
    expect(await isInstanceAdmin(t.db, admin.id)).toBe(true)
    expect(await isInstanceAdmin(t.db, both.id)).toBe(true)
    expect(await isInstanceAdmin(t.db, 'no-such-user')).toBe(false)
  })
})
