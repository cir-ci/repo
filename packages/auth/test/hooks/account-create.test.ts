import * as schema from '@circi/db/schema'
import { createTestDb, seedWorkspace } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { beforeAccountCreate } from '#hooks/account-create.ts'
import type { SsoProvider } from '#plugins/sso/sso.ts'

let t: createTestDb.Result
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
  const { owner } = await seedWorkspace(t.db)
  await t.db
    .update(schema.user)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(schema.user.id, owner.id))
  return owner.id
}
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

  it('refuses with an error code, so the OAuth callback redirects instead of ending on a bare 403', async () => {
    const userId = await userAged(86_400_000)
    await expect(
      beforeAccountCreate(options())({ userId, providerId: 'oidc' }, { path: '/callback/oidc' }),
    ).rejects.toMatchObject({ body: { code: 'provider_not_trusted_to_link' } })
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
