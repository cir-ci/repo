import { schema } from '@circi/db'
import { createTestDb, seedOrg, type TestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { beforeAccountCreate } from '../src/hooks/account-create.ts'
import { beforeUserCreate } from '../src/hooks/user-create.ts'
import type { SsoProvider } from '../src/sso.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const sso = (id: SsoProvider['id'], trustedForEmail: boolean): SsoProvider => ({
  id,
  name: id,
  clientId: 'c',
  clientSecret: 's',
  trustedForEmail,
})
const options = () => ({ db: t.db, sso: [sso('github', true), sso('oidc', false)] })

async function userAged(ms: number) {
  const { owner } = await seedOrg(t.db)
  await t.db
    .update(schema.user)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(schema.user.id, owner.id))
  return owner.id
}

const callback = (id: string) => ({ path: `/callback/${id}`, params: { id } })

describe('beforeUserCreate', () => {
  it('lets nobody create an account through the password sign-in path', async () => {
    // Not an email-code or single sign-on path, so this hook has nothing to say about it.
    await expect(
      beforeUserCreate(options())(
        { email: 'x@x.test', emailVerified: false },
        { path: '/sign-up/email' },
      ),
    ).resolves.toBeUndefined()
  })

  it('refuses an email-code account for an address nobody invited or claimed', async () => {
    await expect(
      beforeUserCreate(options())(
        { email: 'stranger@nowhere.test', emailVerified: true },
        { path: '/sign-in/email-otp' },
      ),
    ).rejects.toThrow(/No account/)
  })

  it('allows it for an invited address', async () => {
    const { org, owner } = await seedOrg(t.db)
    await t.db.insert(schema.invitation).values({
      id: 'inv-1',
      organizationId: org.id,
      email: 'Invited@Acme.test',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600_000),
      inviterId: owner.id,
    })
    await expect(
      beforeUserCreate(options())(
        { email: 'invited@acme.test', emailVerified: true },
        { path: '/sign-in/email-otp' },
      ),
    ).resolves.toBeUndefined()
  })

  it('refuses single sign-on accounts unless invited, or trusted on a verified domain', async () => {
    const stranger = { email: 'nobody@elsewhere.test', emailVerified: true }
    await expect(beforeUserCreate(options())(stranger, callback('github'))).rejects.toThrow(
      /No account/,
    )
    await expect(beforeUserCreate(options())(stranger, callback('oidc'))).rejects.toThrow(
      /No account/,
    )

    const { org } = await seedOrg(t.db)
    await t.db.insert(schema.orgDomains).values({
      orgId: org.id,
      domain: 'corp.test',
      verificationToken: 't',
      verifiedAt: new Date(),
    })
    const colleague = { email: 'ann@corp.test', emailVerified: true }
    await expect(
      beforeUserCreate(options())(colleague, callback('github')),
    ).resolves.toBeUndefined()
    // The generic provider isn't trusted for email, so its word about the domain counts for nothing.
    await expect(beforeUserCreate(options())(colleague, callback('oidc'))).rejects.toThrow(
      /No account/,
    )
    // And a trusted provider must say the address is verified.
    await expect(
      beforeUserCreate(options())({ ...colleague, emailVerified: false }, callback('github')),
    ).rejects.toThrow(/No account/)
  })
})

describe('beforeAccountCreate', () => {
  it('ignores anything that is not a single sign-on callback', async () => {
    const userId = await userAged(86_400_000)
    await expect(
      beforeAccountCreate(options())(
        { userId, providerId: 'credential' },
        { path: '/sign-in/email' },
      ),
    ).resolves.toBeUndefined()
  })

  it('stops an untrusted provider attaching to an account that already existed', async () => {
    const userId = await userAged(86_400_000)
    await expect(
      beforeAccountCreate(options())({ userId, providerId: 'oidc' }, { path: '/callback/oidc' }),
    ).rejects.toThrow(/not trusted/)
  })

  it('lets a trusted provider attach, and an untrusted one create a brand new account', async () => {
    const old = await userAged(86_400_000)
    await expect(
      beforeAccountCreate(options())(
        { userId: old, providerId: 'github' },
        { path: '/callback/github' },
      ),
    ).resolves.toBeUndefined()
    const fresh = await userAged(1_000)
    await expect(
      beforeAccountCreate(options())(
        { userId: fresh, providerId: 'oidc' },
        { path: '/callback/oidc' },
      ),
    ).resolves.toBeUndefined()
  })
})
