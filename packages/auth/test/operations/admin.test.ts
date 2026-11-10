import {
  getTeamById,
  getTeamTokenInfo,
  getWorkspaceBySlug,
  listUserWorkspaceIds,
} from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addMember,
  type Auth,
  createAuth,
  createWorkspace,
  createTeamWithToken,
  createUser,
  rotateTeamToken,
  updateWorkspace,
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

  it('says plainly when the address is taken, also by a deleted workspace', async () => {
    const { owner, workspace, slug } = await workspaceWithOwner()
    await expect(
      createWorkspace(auth, t.db, { name: 'Again', slug, ownerEmail: owner.email }),
    ).rejects.toThrow(`A workspace at /${slug} already exists. Choose another name.`)
    await t.db.insert(schema.workspaceDeletions).values({ workspaceId: workspace.id })
    await expect(
      createWorkspace(auth, t.db, { name: 'Again', slug, ownerEmail: owner.email }),
    ).rejects.toThrow(/was deleted/)
  })

  it('refuses a name that is a dashboard route', async () => {
    const { owner } = await workspaceWithOwner()
    await expect(
      createWorkspace(auth, t.db, { name: 'Inbox', ownerEmail: owner.email }),
    ).rejects.toThrow(/reserved/)
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

describe('CI token facts', () => {
  it('stores only a hash, keeps a short hint, and records who issued it and when it was used', async () => {
    const { owner, slug } = await workspaceWithOwner()
    const first = await createTeamWithToken(auth, t.db, {
      workspaceSlug: slug,
      name: 'tok',
      createdBy: owner.id,
    })
    const [row] = await t.db
      .select()
      .from(schema.apikey)
      .where(eq(schema.apikey.id, first.team.ciKeyId ?? ''))
    // Nothing in the key row is the token, and the row's key column is its hash.
    expect(JSON.stringify(row)).not.toContain(first.token)
    expect(row?.key).not.toBe(first.token)
    expect(row?.key).toMatch(/^[A-Za-z0-9_+/=-]{20,}$/)

    const fresh = await getTeamTokenInfo(t.db, first.team.id)
    expect(fresh.hint).toBe(`${first.token.slice(0, 12)}…`)
    expect(fresh.createdBy).toEqual({ id: owner.id, name: owner.name })
    expect(fresh.createdAt).toBeInstanceOf(Date)
    expect(fresh.lastUsedAt).toBeNull()

    await verifyTeamToken(auth, t.db, first.token)
    expect((await getTeamTokenInfo(t.db, first.team.id)).lastUsedAt).toBeInstanceOf(Date)

    // Rotating makes a different token, forgets the use, and names the person who rotated.
    const dev = await createUser(auth, {
      email: `dev-${slug}@example.com`,
      name: 'Rotator',
      password: 'a-long-password-3',
    })
    const next = await rotateTeamToken(auth, t.db, {
      workspaceSlug: slug,
      teamSlug: 'tok',
      rotatedBy: dev.id,
    })
    expect(next.token).not.toBe(first.token)
    const after = await getTeamTokenInfo(t.db, first.team.id)
    expect(after.hint).toBe(`${next.token.slice(0, 12)}…`)
    expect(after.createdBy).toEqual({ id: dev.id, name: 'Rotator' })
    expect(after.lastUsedAt).toBeNull()
    expect(await verifyTeamToken(auth, t.db, first.token)).toBeUndefined()
    expect((await getTeamById(t.db, first.team.id))?.ciKeyCreatedBy).toBe(dev.id)
  })
})

describe('updateWorkspace', () => {
  it('renames, changes the address, and keeps what was not sent', async () => {
    const { workspace, slug } = await workspaceWithOwner()
    expect(
      await updateWorkspace(auth, t.db, { workspaceId: workspace.id, name: ' New name ' }),
    ).toEqual({
      name: 'New name',
      slug,
    })
    expect(
      await updateWorkspace(auth, t.db, { workspaceId: workspace.id, slug: `${slug}-moved` }),
    ).toEqual({ name: 'New name', slug: `${slug}-moved` })
    expect((await getWorkspaceBySlug(t.db, `${slug}-moved`)).id).toBe(workspace.id)
    await expect(getWorkspaceBySlug(t.db, slug)).rejects.toThrow(/not found/)
  })

  it('applies the creation rules to the address: shape, reserved words, uniqueness', async () => {
    const a = await workspaceWithOwner()
    const b = await workspaceWithOwner()
    const input = { workspaceId: a.workspace.id }
    await expect(updateWorkspace(auth, t.db, { ...input, slug: 'Bad Slug' })).rejects.toThrow(
      /Invalid/,
    )
    await expect(updateWorkspace(auth, t.db, { ...input, slug: 'admin' })).rejects.toThrow(
      /reserved/,
    )
    await expect(updateWorkspace(auth, t.db, { ...input, slug: b.slug })).rejects.toThrow(
      /already taken/,
    )
    await expect(updateWorkspace(auth, t.db, { ...input, name: '  ' })).rejects.toThrow(
      /name is required/,
    )
    await expect(
      updateWorkspace(auth, t.db, { workspaceId: 'missing', name: 'x' }),
    ).rejects.toThrow(/not found/)
    // Sending the address it already has is not a conflict.
    await expect(updateWorkspace(auth, t.db, { ...input, slug: a.slug })).resolves.toBeDefined()
  })
})
