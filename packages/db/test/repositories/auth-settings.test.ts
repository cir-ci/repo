import { createTestDb, seedOrg, seedSession } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ConflictError,
  getOrgAuthSettings,
  getSessionMethod,
  listRefusingOrganizations,
  orgAcceptsSession,
  recordSessionMethod,
  schema,
  setOrgAuthSettings,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const instance = { password: true, email: true, oidc: false }

describe('org auth settings', () => {
  it('accepts everything until narrowed, and saves a narrowing', async () => {
    const { org } = await seedOrg(t.db)
    expect(await getOrgAuthSettings(t.db, org.id)).toEqual({
      emailLoginEnabled: true,
      passwordLoginEnabled: true,
    })
    const saved = await setOrgAuthSettings(
      t.db,
      org.id,
      { passwordLoginEnabled: false },
      { instance },
    )
    expect(saved).toEqual({ emailLoginEnabled: true, passwordLoginEnabled: false })
    expect(await getOrgAuthSettings(t.db, org.id)).toEqual(saved)
  })

  it('refuses a change that leaves no owner able to sign in, unless forced', async () => {
    const { org } = await seedOrg(t.db) // the owner has no account at all
    const off = { emailLoginEnabled: false }
    await expect(setOrgAuthSettings(t.db, org.id, off, { instance })).rejects.toBeInstanceOf(
      ConflictError,
    )
    await setOrgAuthSettings(t.db, org.id, off, { instance, force: true })
    expect((await getOrgAuthSettings(t.db, org.id)).emailLoginEnabled).toBe(false)
  })

  it('lets a password owner keep password sign-in while email is off', async () => {
    const { org, owner } = await seedOrg(t.db)
    await t.db.insert(schema.account).values({
      id: `acc-${owner.id}`,
      accountId: owner.id,
      providerId: 'credential',
      userId: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const saved = await setOrgAuthSettings(t.db, org.id, { emailLoginEnabled: false }, { instance })
    expect(saved.emailLoginEnabled).toBe(false)
  })
})

describe('session methods', () => {
  it('remembers how a session signed in, and overwrites it', async () => {
    const { owner } = await seedOrg(t.db)
    const s = await seedSession(t.db, owner.id)
    expect(await getSessionMethod(t.db, s.id)).toBeUndefined()
    await recordSessionMethod(t.db, s.id, 'password')
    expect(await getSessionMethod(t.db, s.id)).toBe('password')
    await recordSessionMethod(t.db, s.id, 'email')
    expect(await getSessionMethod(t.db, s.id)).toBe('email')
  })

  it('scopes an org-oidc session to one organization', async () => {
    const { org, owner } = await seedOrg(t.db)
    const s = await seedSession(t.db, owner.id)
    await recordSessionMethod(t.db, s.id, 'org-oidc', org.id)
    expect(await getSessionMethod(t.db, s.id)).toEqual({ scopedTo: org.id })
    const unscoped = await seedSession(t.db, owner.id)
    await recordSessionMethod(t.db, unscoped.id, 'org-oidc')
    expect(await getSessionMethod(t.db, unscoped.id)).toBeUndefined()
  })
})

describe('orgAcceptsSession and listRefusingOrganizations', () => {
  it('applies each organization’s switches to the way a session signed in', async () => {
    const { org, owner } = await seedOrg(t.db)
    await setOrgAuthSettings(
      t.db,
      org.id,
      { passwordLoginEnabled: false },
      { instance, force: true },
    )
    const other = await seedOrg(t.db)

    expect(await orgAcceptsSession(t.db, org.id, 'password')).toBe(false)
    expect(await orgAcceptsSession(t.db, org.id, 'email')).toBe(true)
    expect(await orgAcceptsSession(t.db, org.id, 'oidc')).toBe(true) // single sign-on always
    expect(await orgAcceptsSession(t.db, org.id, 'unknown')).toBe(false) // restricted org
    expect(await orgAcceptsSession(t.db, org.id, undefined)).toBe(true) // not a dashboard session
    expect(await orgAcceptsSession(t.db, other.org.id, 'unknown')).toBe(true) // nothing restricted
    expect(await orgAcceptsSession(t.db, org.id, { scopedTo: other.org.id })).toBe(false)
    expect(await orgAcceptsSession(t.db, org.id, { scopedTo: org.id })).toBe(true)

    expect(await listRefusingOrganizations(t.db, owner.id, 'password')).toEqual([
      { name: org.name, accepts: ['email'] },
    ])
    expect(await listRefusingOrganizations(t.db, owner.id, 'email')).toEqual([])
  })
})
