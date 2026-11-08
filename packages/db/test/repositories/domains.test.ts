import { ValidationError } from '@circi/core'
import { createTestDb, seedOrg, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addOrgDomain,
  ConflictError,
  listOrgDomains,
  normalizeDomain,
  NotFoundError,
  organizationsForEmailDomain,
  removeOrgDomain,
  verificationName,
  verificationValue,
  verifyOrgDomain,
} from '../../src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('normalizeDomain', () => {
  it('lowercases and strips an @ or a trailing dot', () => {
    expect(normalizeDomain('  @Example.COM. ')).toBe('example.com')
  })

  it('rejects anything that is not a bare domain', () => {
    for (const bad of ['', 'localhost', 'a@b.com', 'example.com/path', 'exa mple.com']) {
      expect(() => normalizeDomain(bad)).toThrow(ValidationError)
    }
  })
})

describe('org domains', () => {
  it('adds, lists (sorted) and removes a domain, refusing a duplicate', async () => {
    const { org } = await seedOrg(t.db)
    await addOrgDomain(t.db, org.id, 'b.example.com')
    const a = await addOrgDomain(t.db, org.id, 'A.example.com')
    expect(a.verifiedAt).toBeNull()
    expect(a.verificationToken.length).toBeGreaterThan(10)
    await expect(addOrgDomain(t.db, org.id, 'a.example.com')).rejects.toBeInstanceOf(ConflictError)
    expect((await listOrgDomains(t.db, org.id)).map((d) => d.domain)).toEqual([
      'a.example.com',
      'b.example.com',
    ])
    await removeOrgDomain(t.db, org.id, a.id)
    expect((await listOrgDomains(t.db, org.id)).map((d) => d.domain)).toEqual(['b.example.com'])
  })

  it('will not remove another organization’s domain', async () => {
    const mine = await seedOrg(t.db)
    const theirs = await seedOrg(t.db)
    const domain = await addOrgDomain(t.db, theirs.org.id, 'theirs.example.com')
    await expect(removeOrgDomain(t.db, mine.org.id, domain.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('verifyOrgDomain', () => {
  it('verifies only when the TXT record holds the token, even split into chunks', async () => {
    const { org } = await seedOrg(t.db)
    const domain = await addOrgDomain(t.db, org.id, 'verify.example.com')
    const asked: string[] = []
    const expected = verificationValue(domain)

    expect(await verifyOrgDomain(t.db, org.id, domain.id, () => Promise.resolve([['nope']]))).toBe(
      false,
    )
    expect(
      await verifyOrgDomain(t.db, org.id, domain.id, () => Promise.reject(new Error('nx'))),
    ).toBe(false)
    const half = Math.floor(expected.length / 2)
    const lookup = (name: string) => {
      asked.push(name)
      return Promise.resolve([[expected.slice(0, half), expected.slice(half)]])
    }
    expect(await verifyOrgDomain(t.db, org.id, domain.id, lookup)).toBe(true)
    expect(asked).toEqual([verificationName('verify.example.com')])
    // Already verified: no second lookup.
    expect(await verifyOrgDomain(t.db, org.id, domain.id, lookup)).toBe(true)
    expect(asked).toHaveLength(1)
  })

  it('refuses a domain another organization already verified', async () => {
    const first = await seedOrg(t.db)
    const second = await seedOrg(t.db)
    const a = await addOrgDomain(t.db, first.org.id, 'shared.example.com')
    const b = await addOrgDomain(t.db, second.org.id, 'shared.example.com')
    const proves = (d: typeof a) => () => Promise.resolve([[verificationValue(d)]])
    expect(await verifyOrgDomain(t.db, first.org.id, a.id, proves(a))).toBe(true)
    await expect(verifyOrgDomain(t.db, second.org.id, b.id, proves(b))).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it('throws for an unknown domain', async () => {
    const { org } = await seedOrg(t.db)
    await expect(
      verifyOrgDomain(t.db, org.id, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('organizationsForEmailDomain', () => {
  it('finds organizations by verified domain only', async () => {
    const verified = await seedOrg(t.db)
    const unverified = await seedOrg(t.db)
    const v = await addOrgDomain(t.db, verified.org.id, 'join.example.com')
    await addOrgDomain(t.db, unverified.org.id, 'pending.example.com')
    await verifyOrgDomain(t.db, verified.org.id, v.id, () =>
      Promise.resolve([[verificationValue(v)]]),
    )

    expect(await organizationsForEmailDomain(t.db, ' Ann@Join.Example.com ')).toEqual([
      { orgId: verified.org.id, role: 'member' },
    ])
    expect(await organizationsForEmailDomain(t.db, 'ann@pending.example.com')).toEqual([])
    expect(await organizationsForEmailDomain(t.db, 'not-an-address')).toEqual([])
  })
})
