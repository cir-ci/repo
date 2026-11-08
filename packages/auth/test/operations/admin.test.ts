import { listUserWorkspaceIds } from '@circi/db'
import { createTestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addMember,
  type Auth,
  createAuth,
  createWorkspace,
  createTeamWithToken,
  createUser,
  rotateTeamToken,
  verifyTeamToken,
} from '#src/index.ts'

let t: createTestDb.Result
let auth: Auth

beforeAll(async () => {
  t = await createTestDb()
  auth = createAuth({
    db: t.db,
    secret: 'test-secret-that-is-long-enough-1234',
    baseURL: 'http://localhost:3000',
  })
})
afterAll(async () => {
  await t.close()
})

let n = 0
async function workspaceWithOwner() {
  n += 1
  const owner = await createUser(auth, {
    email: `owner${n}@example.com`,
    name: `Owner ${n}`,
    password: 'a-long-password-1',
  })
  const workspace = await createWorkspace(auth, t.db, {
    name: `Workspace ${n}`,
    slug: `workspace-${n}`,
    ownerEmail: owner.email,
  })
  return { owner, workspace, slug: `workspace-${n}` }
}

describe('accounts and workspaces', () => {
  it('creates a user who owns a new workspace', async () => {
    const { owner, workspace } = await workspaceWithOwner()
    expect(await listUserWorkspaceIds(t.db, owner.id)).toEqual([workspace.id])
  })

  it('adds members by email', async () => {
    const { workspace, slug } = await workspaceWithOwner()
    const dev = await createUser(auth, {
      email: 'Dev@Example.com',
      name: 'Dev',
      password: 'a-long-password-2',
    })
    await addMember(auth, t.db, { workspaceSlug: slug, email: 'dev@example.com', role: 'member' })
    expect(await listUserWorkspaceIds(t.db, dev.id)).toEqual([workspace.id])
  })

  it('rejects short passwords', async () => {
    await expect(
      createUser(auth, { email: 'x@example.com', name: 'X', password: 'short' }),
    ).rejects.toThrow(/at least 12 characters/)
  })
})

describe('CI tokens (better-auth API keys owned by the workspace)', () => {
  it('issues a circi_ token that resolves to its team', async () => {
    const { slug } = await workspaceWithOwner()
    const { team, token } = await createTeamWithToken(auth, t.db, {
      workspaceSlug: slug,
      name: 'Web app',
    })
    expect(token).toMatch(/^circi_/)
    expect(team.ciKeyId).toBeTruthy()
    const ctx = await verifyTeamToken(auth, t.db, token)
    expect(ctx).toMatchObject({ workspaceSlug: slug, team: { id: team.id, slug: 'web-app' } })
  })

  it('stores only a hash of the token', async () => {
    const { slug } = await workspaceWithOwner()
    const { token } = await createTeamWithToken(auth, t.db, { workspaceSlug: slug, name: 'p' })
    const rows = await t.client.query('select key from apikey')
    expect(JSON.stringify(rows.rows)).not.toContain(token)
  })

  it('stops accepting the old token as soon as it is rotated', async () => {
    const { slug } = await workspaceWithOwner()
    const first = await createTeamWithToken(auth, t.db, { workspaceSlug: slug, name: 'p' })
    const second = await rotateTeamToken(auth, t.db, { workspaceSlug: slug, teamSlug: 'p' })
    expect(second.token).not.toBe(first.token)
    expect(await verifyTeamToken(auth, t.db, first.token)).toBeUndefined()
    expect(await verifyTeamToken(auth, t.db, second.token)).toMatchObject({
      team: { slug: 'p' },
    })
  })

  it('rejects unknown and malformed tokens', async () => {
    expect(await verifyTeamToken(auth, t.db, `circi_${'x'.repeat(64)}`)).toBeUndefined()
    expect(await verifyTeamToken(auth, t.db, 'not-a-token')).toBeUndefined()
  })

  it('keeps working through a whole CI run (no per-key daily cap)', async () => {
    const { slug } = await workspaceWithOwner()
    const { token } = await createTeamWithToken(auth, t.db, { workspaceSlug: slug, name: 'busy' })
    for (let i = 0; i < 30; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential requests, like a CI run polling
      expect(await verifyTeamToken(auth, t.db, token)).toBeDefined()
    }
  })
})
