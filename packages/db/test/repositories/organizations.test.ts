import { addTestMember, createTestDb, seedOrg, seedUser } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  findOrganizationOwnerId,
  getMemberRole,
  getOrganizationBySlug,
  listOrganizations,
  listUserOrganizationIds,
  NotFoundError,
} from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('organizations and memberships (read side; better-auth owns the writes)', () => {
  it('looks organizations up by slug', async () => {
    const { org } = await seedOrg(t.db)
    expect(await getOrganizationBySlug(t.db, org.slug)).toMatchObject({ id: org.id })
    await expect(getOrganizationBySlug(t.db, 'nope')).rejects.toBeInstanceOf(NotFoundError)
    expect((await listOrganizations(t.db)).map((o) => o.slug)).toContain(org.slug)
  })

  it('lists exactly the organizations a user belongs to', async () => {
    const one = await seedOrg(t.db)
    const two = await seedOrg(t.db)
    await addTestMember(t.db, { orgId: two.org.id, userId: one.owner.id, role: 'member' })
    expect((await listUserOrganizationIds(t.db, one.owner.id)).toSorted()).toEqual(
      [one.org.id, two.org.id].toSorted(),
    )
    expect(await listUserOrganizationIds(t.db, two.owner.id)).toEqual([two.org.id])
    expect(await listUserOrganizationIds(t.db, (await seedUser(t.db)).id)).toEqual([])
  })

  it('reports a member’s role, and nothing for non-members', async () => {
    const { org, owner } = await seedOrg(t.db)
    const dev = await seedUser(t.db)
    await addTestMember(t.db, { orgId: org.id, userId: dev.id, role: 'member' })
    expect(await getMemberRole(t.db, { userId: owner.id, organizationId: org.id })).toBe('owner')
    expect(await getMemberRole(t.db, { userId: dev.id, organizationId: org.id })).toBe('member')
    const outsider = await seedUser(t.db)
    expect(
      await getMemberRole(t.db, { userId: outsider.id, organizationId: org.id }),
    ).toBeUndefined()
  })

  it('finds an owner to issue CI tokens on behalf of, even with admins around', async () => {
    const { org, owner } = await seedOrg(t.db)
    const admin = await seedUser(t.db)
    await addTestMember(t.db, { orgId: org.id, userId: admin.id, role: 'admin' })
    expect(await findOrganizationOwnerId(t.db, org.id)).toBe(owner.id)
    expect(await findOrganizationOwnerId(t.db, 'no-such-org')).toBeUndefined()
  })
})
