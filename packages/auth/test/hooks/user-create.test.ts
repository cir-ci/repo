import { createTestDb, seedInvitation, seedWorkspace, seedWorkspaceDomain } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { beforeUserCreate } from '#hooks/user-create.ts'
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
    const { workspace, owner } = await seedWorkspace(t.db)
    await seedInvitation(t.db, {
      workspaceId: workspace.id,
      inviterId: owner.id,
      email: 'Invited@Acme.test',
    })
    await expect(
      beforeUserCreate(options())(
        { email: 'invited@acme.test', name: 'Ivy', emailVerified: true },
        { path: '/sign-in/email-otp' },
      ),
    ).resolves.toBeUndefined()
  })

  it('names an account created by a code after the part of its address before the @ (no blank names)', async () => {
    await seedWorkspaceDomain(t.db, {
      workspaceId: (await seedWorkspace(t.db)).workspace.id,
      domain: 'named.test',
    })
    await expect(
      beforeUserCreate(options())(
        { email: 'grace.hopper@named.test', name: '', emailVerified: true },
        { path: '/sign-in/email-otp' },
      ),
    ).resolves.toEqual({ data: { name: 'grace.hopper' } })
  })

  it('refuses with an error code, so the OAuth callback redirects instead of ending on a bare 403', async () => {
    // better-auth only redirects to the error URL for an APIError that carries a `code`.
    await expect(
      beforeUserCreate(options())(
        { email: 'nobody@elsewhere.test', emailVerified: true },
        callback('oidc'),
      ),
    ).rejects.toMatchObject({ body: { code: 'no_account_for_address' } })
  })

  it('refuses single sign-on accounts unless invited, or trusted on a verified domain', async () => {
    const stranger = { email: 'nobody@elsewhere.test', emailVerified: true }
    await expect(beforeUserCreate(options())(stranger, callback('github'))).rejects.toThrow(
      /No account/,
    )
    await expect(beforeUserCreate(options())(stranger, callback('oidc'))).rejects.toThrow(
      /No account/,
    )

    const { workspace } = await seedWorkspace(t.db)
    await seedWorkspaceDomain(t.db, { workspaceId: workspace.id, domain: 'corp.test' })
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
