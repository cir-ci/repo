import { schema } from '@circi/db'
import { createTestDb, seedOrg, seedSsoProvider, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { trustedOriginsFor, withTrustedIssuer } from '../../src/sso/trusted-issuers.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('trustedOriginsFor', () => {
  it('lists the origins of registered issuers, ignoring malformed ones', async () => {
    const { owner, org } = await seedOrg(t.db)
    await seedSsoProvider(t.db, {
      orgId: org.id,
      userId: owner.id,
      issuer: 'https://login.acme.io/realms/x',
      domain: 'login.acme.io',
    })
    await seedSsoProvider(t.db, {
      orgId: org.id,
      userId: owner.id,
      issuer: 'not a url',
      domain: 'x',
    })
    expect(await trustedOriginsFor(t.db)()).toEqual(['https://login.acme.io'])
  })

  it('survives a database that has no tables yet (better-auth asks while starting up)', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const empty = new PGlite()
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const db = drizzle({ client: empty, schema }) as never
    expect(await trustedOriginsFor(db)()).toEqual([])
    await empty.close()
  })
})

describe('withTrustedIssuer', () => {
  it('trusts the origin only while the call runs', async () => {
    const context = { trustedOrigins: ['https://ci.acme.io'] }
    const auth = { $context: Promise.resolve(context) }
    let during: string[] = []
    await withTrustedIssuer(auth, 'https://idp.example.com/path', async () => {
      during = [...context.trustedOrigins]
    })
    expect(during).toEqual(['https://ci.acme.io', 'https://idp.example.com'])
    expect(context.trustedOrigins).toEqual(['https://ci.acme.io'])
  })

  it('withdraws the trust even when the call fails', async () => {
    const context = { trustedOrigins: [] as string[] }
    await withTrustedIssuer({ $context: Promise.resolve(context) }, 'https://idp.example.com', () =>
      Promise.reject(new Error('discovery failed')),
    ).catch(() => {})
    expect(context.trustedOrigins).toEqual([])
  })
})
