import {
  getWorkspaceAuthSettings,
  getWorkspaceSettings,
  listWorkspaceDomains,
} from '@circi/db/queries'
import { createTestDb, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addEmailDomain,
  dismissPublicUrlNotice,
  removeEmailDomain,
  updateWorkspaceSettings,
  updateWorkspaceSignIn,
  verifyEmailDomain,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('email domains', () => {
  it('adds, verifies by DNS proof, and removes a domain', async () => {
    const { workspace } = await seedProject(t.db)
    const added = await addEmailDomain(t.db, { workspaceId: workspace.id, domain: '@Acme.Test' })
    expect(added.domain).toBe('acme.test')
    expect(added.verifiedAt).toBeNull()

    const none = await verifyEmailDomain(t.db, {
      workspaceId: workspace.id,
      id: added.id,
      resolveTxt: async () => [],
    })
    expect(none).toEqual({
      verified: false,
      reason: `No TXT record _circi-verify.acme.test found`,
    })
    const ok = await verifyEmailDomain(t.db, {
      workspaceId: workspace.id,
      id: added.id,
      resolveTxt: async () => [[`circi-verify=${added.verificationToken}`]],
    })
    expect(ok).toEqual({ verified: true })
    expect((await listWorkspaceDomains(t.db, workspace.id))[0]?.verifiedAt).not.toBeNull()

    await removeEmailDomain(t.db, { workspaceId: workspace.id, id: added.id })
    expect(await listWorkspaceDomains(t.db, workspace.id)).toEqual([])
  })

  it('refuses a duplicate and rolls back nothing half-done', async () => {
    const { workspace } = await seedProject(t.db)
    await addEmailDomain(t.db, { workspaceId: workspace.id, domain: 'dup.test' })
    await expect(
      addEmailDomain(t.db, { workspaceId: workspace.id, domain: 'dup.test' }),
    ).rejects.toThrow(/already on this list/)
    expect(await listWorkspaceDomains(t.db, workspace.id)).toHaveLength(1)
  })
})

describe('workspace settings', () => {
  it('returns the merged settings and rejects a bad retention', async () => {
    const { workspace } = await seedProject(t.db)
    const next = await updateWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: true })
    expect(next.flakyBlocksMerge).toBe(true)
    expect(await getWorkspaceSettings(t.db, workspace.id)).toEqual(next)
    await expect(updateWorkspaceSettings(t.db, workspace.id, { retentionDays: 0 })).rejects.toThrow(
      /between 1 and 3650 days/,
    )
  })
})

describe('workspace sign-in', () => {
  const instance = { password: true, email: true, github: false, google: false, oidc: false }

  it('stores the switches, and refuses to lock every owner out unless forced', async () => {
    // The seeded owner has no credential, so no method is usable by an owner.
    const { workspace } = await seedProject(t.db)
    await expect(
      updateWorkspaceSignIn(t.db, workspace.id, { emailLoginEnabled: false }, { instance }),
    ).rejects.toThrow(/no owner able to sign in/)
    const next = await updateWorkspaceSignIn(
      t.db,
      workspace.id,
      { emailLoginEnabled: false },
      { instance, force: true },
    )
    expect(next.emailLoginEnabled).toBe(false)
    expect((await getWorkspaceAuthSettings(t.db, workspace.id)).emailLoginEnabled).toBe(false)
  })
})

describe('instance notices', () => {
  it('dismisses the public address notice (also when there is none)', async () => {
    await expect(dismissPublicUrlNotice(t.db)).resolves.toBeUndefined()
  })
})
