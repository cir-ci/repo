import { ValidationError } from '@circi/core'
import { createTestDb, seedWorkspace } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addWorkspaceDomain,
  ConflictError,
  listWorkspaceDomains,
  normalizeDomain,
  NotFoundError,
  workspacesForEmailDomain,
  removeWorkspaceDomain,
  verificationName,
  verificationValue,
  verifyWorkspaceDomain,
} from '#src/index.ts'

let t: createTestDb.Result
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

describe('workspace domains', () => {
  it('adds, lists (sorted) and removes a domain, refusing a duplicate', async () => {
    const { workspace } = await seedWorkspace(t.db)
    await addWorkspaceDomain(t.db, workspace.id, 'b.example.com')
    const a = await addWorkspaceDomain(t.db, workspace.id, 'A.example.com')
    expect(a.verifiedAt).toBeNull()
    expect(a.verificationToken.length).toBeGreaterThan(10)
    await expect(addWorkspaceDomain(t.db, workspace.id, 'a.example.com')).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect((await listWorkspaceDomains(t.db, workspace.id)).map((d) => d.domain)).toEqual([
      'a.example.com',
      'b.example.com',
    ])
    await removeWorkspaceDomain(t.db, workspace.id, a.id)
    expect((await listWorkspaceDomains(t.db, workspace.id)).map((d) => d.domain)).toEqual([
      'b.example.com',
    ])
  })

  it('will not remove another workspace’s domain', async () => {
    const mine = await seedWorkspace(t.db)
    const theirs = await seedWorkspace(t.db)
    const domain = await addWorkspaceDomain(t.db, theirs.workspace.id, 'theirs.example.com')
    await expect(removeWorkspaceDomain(t.db, mine.workspace.id, domain.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('verifyWorkspaceDomain', () => {
  it('verifies only when the TXT record holds the token, even split into chunks', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const domain = await addWorkspaceDomain(t.db, workspace.id, 'verify.example.com')
    const asked: string[] = []
    const expected = verificationValue(domain)

    expect(
      await verifyWorkspaceDomain(t.db, workspace.id, domain.id, () => Promise.resolve([['nope']])),
    ).toBe(false)
    expect(
      await verifyWorkspaceDomain(t.db, workspace.id, domain.id, () =>
        Promise.reject(new Error('nx')),
      ),
    ).toBe(false)
    const half = Math.floor(expected.length / 2)
    const lookup = (name: string) => {
      asked.push(name)
      return Promise.resolve([[expected.slice(0, half), expected.slice(half)]])
    }
    expect(await verifyWorkspaceDomain(t.db, workspace.id, domain.id, lookup)).toBe(true)
    expect(asked).toEqual([verificationName('verify.example.com')])
    // Already verified: no second lookup.
    expect(await verifyWorkspaceDomain(t.db, workspace.id, domain.id, lookup)).toBe(true)
    expect(asked).toHaveLength(1)
  })

  it('refuses a domain another workspace already verified', async () => {
    const first = await seedWorkspace(t.db)
    const second = await seedWorkspace(t.db)
    const a = await addWorkspaceDomain(t.db, first.workspace.id, 'shared.example.com')
    const b = await addWorkspaceDomain(t.db, second.workspace.id, 'shared.example.com')
    const proves = (d: typeof a) => () => Promise.resolve([[verificationValue(d)]])
    expect(await verifyWorkspaceDomain(t.db, first.workspace.id, a.id, proves(a))).toBe(true)
    await expect(
      verifyWorkspaceDomain(t.db, second.workspace.id, b.id, proves(b)),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('throws for an unknown domain', async () => {
    const { workspace } = await seedWorkspace(t.db)
    await expect(
      verifyWorkspaceDomain(t.db, workspace.id, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('workspacesForEmailDomain', () => {
  it('finds workspaces by verified domain only', async () => {
    const verified = await seedWorkspace(t.db)
    const unverified = await seedWorkspace(t.db)
    const v = await addWorkspaceDomain(t.db, verified.workspace.id, 'join.example.com')
    await addWorkspaceDomain(t.db, unverified.workspace.id, 'pending.example.com')
    await verifyWorkspaceDomain(t.db, verified.workspace.id, v.id, () =>
      Promise.resolve([[verificationValue(v)]]),
    )

    expect(await workspacesForEmailDomain(t.db, ' Ann@Join.Example.com ')).toEqual([
      { workspaceId: verified.workspace.id, role: 'member' },
    ])
    expect(await workspacesForEmailDomain(t.db, 'ann@pending.example.com')).toEqual([])
    expect(await workspacesForEmailDomain(t.db, 'not-an-address')).toEqual([])
  })
})
