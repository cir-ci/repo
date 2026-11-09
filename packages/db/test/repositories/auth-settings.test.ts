import { createTestDb, seedWorkspace, seedSession } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConflictError } from '#src/index.ts'
import {
  getWorkspaceAuthSettings,
  getSessionMethod,
  listRefusingWorkspaces,
  workspaceAcceptsSession,
} from '#src/queries/index.ts'
import { recordSessionMethod, setWorkspaceAuthSettings } from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const instance = { password: true, email: true, github: false, google: false, oidc: false }

describe('workspace auth settings', () => {
  it('accepts everything until narrowed, and saves a narrowing', async () => {
    const { workspace } = await seedWorkspace(t.db)
    expect(await getWorkspaceAuthSettings(t.db, workspace.id)).toEqual({
      emailLoginEnabled: true,
      passwordLoginEnabled: true,
      signinGithub: true,
      signinGoogle: true,
    })
    const saved = await setWorkspaceAuthSettings(
      t.db,
      workspace.id,
      { passwordLoginEnabled: false },
      { instance },
    )
    expect(saved).toEqual({
      emailLoginEnabled: true,
      passwordLoginEnabled: false,
      signinGithub: true,
      signinGoogle: true,
    })
    expect(await getWorkspaceAuthSettings(t.db, workspace.id)).toEqual(saved)
  })

  it('refuses a change that leaves no owner able to sign in, unless forced', async () => {
    const { workspace } = await seedWorkspace(t.db) // the owner has no account at all
    const off = { emailLoginEnabled: false }
    await expect(
      setWorkspaceAuthSettings(t.db, workspace.id, off, { instance }),
    ).rejects.toBeInstanceOf(ConflictError)
    await setWorkspaceAuthSettings(t.db, workspace.id, off, { instance, force: true })
    expect((await getWorkspaceAuthSettings(t.db, workspace.id)).emailLoginEnabled).toBe(false)
  })

  it('lets a password owner keep password sign-in while email is off', async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    await t.db.insert(schema.account).values({
      id: `acc-${owner.id}`,
      accountId: owner.id,
      providerId: 'credential',
      userId: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const saved = await setWorkspaceAuthSettings(
      t.db,
      workspace.id,
      { emailLoginEnabled: false },
      { instance },
    )
    expect(saved.emailLoginEnabled).toBe(false)
  })
})

describe('session methods', () => {
  it('remembers how a session signed in, and overwrites it', async () => {
    const { owner } = await seedWorkspace(t.db)
    const s = await seedSession(t.db, owner.id)
    expect(await getSessionMethod(t.db, s.id)).toBeUndefined()
    await recordSessionMethod(t.db, s.id, 'password')
    expect(await getSessionMethod(t.db, s.id)).toBe('password')
    await recordSessionMethod(t.db, s.id, 'email')
    expect(await getSessionMethod(t.db, s.id)).toBe('email')
  })

  it('scopes a workspace-oidc session to one workspace', async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    const s = await seedSession(t.db, owner.id)
    await recordSessionMethod(t.db, s.id, 'workspace-oidc', workspace.id)
    expect(await getSessionMethod(t.db, s.id)).toEqual({ scopedTo: workspace.id })
    const unscoped = await seedSession(t.db, owner.id)
    await recordSessionMethod(t.db, unscoped.id, 'workspace-oidc')
    expect(await getSessionMethod(t.db, unscoped.id)).toBeUndefined()
  })
})

describe('workspaceAcceptsSession and listRefusingWorkspaces', () => {
  it('applies each workspace’s switches to the way a session signed in', async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    await setWorkspaceAuthSettings(
      t.db,
      workspace.id,
      { passwordLoginEnabled: false },
      { instance, force: true },
    )
    const other = await seedWorkspace(t.db)

    expect(await workspaceAcceptsSession(t.db, workspace.id, 'password')).toBe(false)
    expect(await workspaceAcceptsSession(t.db, workspace.id, 'email')).toBe(true)
    expect(await workspaceAcceptsSession(t.db, workspace.id, 'oidc')).toBe(true) // single sign-on always
    expect(await workspaceAcceptsSession(t.db, workspace.id, 'unknown')).toBe(false) // restricted workspace
    expect(await workspaceAcceptsSession(t.db, workspace.id, undefined)).toBe(true) // not a dashboard session
    expect(await workspaceAcceptsSession(t.db, other.workspace.id, 'unknown')).toBe(true) // nothing restricted
    expect(
      await workspaceAcceptsSession(t.db, workspace.id, { scopedTo: other.workspace.id }),
    ).toBe(false)
    expect(await workspaceAcceptsSession(t.db, workspace.id, { scopedTo: workspace.id })).toBe(true)

    expect(await listRefusingWorkspaces(t.db, owner.id, 'password')).toEqual([
      { name: workspace.name, accepts: ['email'] },
    ])
    expect(await listRefusingWorkspaces(t.db, owner.id, 'email')).toEqual([])
  })
})
