import { getSessionMethod, schema, setWorkspaceAuthSettings } from '@circi/db'
import {
  createTestDb,
  seedSession,
  seedUser,
  seedWorkspace,
  seedWorkspaceDomain,
} from '@circi/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { onSessionCreated } from '#hooks/session-created.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const sso = (id: 'github' | 'google') => ({
  id,
  name: id,
  clientId: 'c',
  clientSecret: 's',
  trustedForEmail: true,
})
const hook = () =>
  onSessionCreated({
    db: t.db,
    secret: 's',
    baseURL: 'https://x.test',
    sso: [sso('github'), sso('google')],
  })
const callback = (id: string) => ({ path: `/callback/${id}`, params: { id } })
const instance = { password: true, email: true, github: true, google: true, oidc: false }

describe('onSessionCreated', () => {
  it('remembers which provider a single sign-on session came through', async () => {
    const user = await seedUser(t.db)
    const github = await seedSession(t.db, user.id)
    await hook()({ id: github.id, userId: user.id }, callback('github'))
    expect(await getSessionMethod(t.db, github.id)).toEqual({ oidcProvider: 'github' })
    const google = await seedSession(t.db, user.id)
    await hook()({ id: google.id, userId: user.id }, callback('google'))
    expect(await getSessionMethod(t.db, google.id)).toEqual({ oidcProvider: 'google' })
    // A provider without a switch stays plain single sign-on.
    const other = await seedSession(t.db, user.id)
    await hook()({ id: other.id, userId: user.id }, callback('oidc'))
    expect(await getSessionMethod(t.db, other.id)).toBe('oidc')
  })

  it('does not join a workspace by domain through a provider the workspace switched off', async () => {
    const { workspace } = await seedWorkspace(t.db)
    await seedWorkspaceDomain(t.db, { workspaceId: workspace.id, domain: 'joiners.test' })
    // The owner could only sign in with email, so keep that on while GitHub goes off.
    await setWorkspaceAuthSettings(t.db, workspace.id, { signinGithub: false }, { instance })

    const viaGithub = await seedUser(t.db, 'a@joiners.test')
    await t.db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, viaGithub.id))
    const s1 = await seedSession(t.db, viaGithub.id)
    await hook()({ id: s1.id, userId: viaGithub.id }, callback('github'))
    const joined = (userId: string) =>
      t.db
        .select()
        .from(schema.member)
        .where(and(eq(schema.member.workspaceId, workspace.id), eq(schema.member.userId, userId)))
    expect(await joined(viaGithub.id)).toHaveLength(0)

    const viaGoogle = await seedUser(t.db, 'b@joiners.test')
    await t.db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, viaGoogle.id))
    const s2 = await seedSession(t.db, viaGoogle.id)
    await hook()({ id: s2.id, userId: viaGoogle.id }, callback('google'))
    expect(await joined(viaGoogle.id)).toHaveLength(1)
  })

  it('does not join a deleted workspace by domain', async () => {
    const { workspace } = await seedWorkspace(t.db)
    await seedWorkspaceDomain(t.db, { workspaceId: workspace.id, domain: 'gone.test' })
    await t.db.insert(schema.workspaceDeletions).values({ workspaceId: workspace.id })
    const user = await seedUser(t.db, 'c@gone.test')
    await t.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id))
    const s = await seedSession(t.db, user.id)
    await hook()({ id: s.id, userId: user.id }, callback('github'))
    expect(
      await t.db.select().from(schema.member).where(eq(schema.member.userId, user.id)),
    ).toHaveLength(0)
  })
})
