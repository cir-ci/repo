import { hashToken } from '@circi/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ConflictError,
  createOrganization,
  createProject,
  listOrganizations,
  listProjects,
  NotFoundError,
  rotateProjectToken,
} from '../../src/index.ts'
import { createTestDb, type TestDb } from '../helpers.ts'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('organizations and projects', () => {
  it('creates an org with a derived slug and rejects duplicates', async () => {
    const org = await createOrganization(t.db, { name: 'Acme Inc' })
    expect(org.slug).toBe('acme-inc')
    await expect(createOrganization(t.db, { name: 'Acme Inc' })).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect((await listOrganizations(t.db)).map((o) => o.slug)).toContain('acme-inc')
  })

  it('creates a project whose token is stored only as a hash', async () => {
    await createOrganization(t.db, { name: 'Tokens', slug: 'tokens' })
    const { project, token } = await createProject(t.db, { orgSlug: 'tokens', name: 'Web app' })
    expect(project.slug).toBe('web-app')
    expect(project.defaultBranch).toBe('main')
    expect(project.tokenHash).toBe(hashToken(token))
    expect(project.tokenHint).toBe(`${token.slice(0, 12)}…`)
    const raw = await t.client.query(`select * from projects where id = $1`, [project.id])
    expect(JSON.stringify(raw.rows)).not.toContain(token)
  })

  it('applies the plan defaults to new projects', async () => {
    await createOrganization(t.db, { name: 'Defaults', slug: 'defaults' })
    const { project } = await createProject(t.db, { orgSlug: 'defaults', name: 'p' })
    expect(project).toMatchObject({
      diffThreshold: 0,
      autoApproveDefaultBranch: true,
      blockMergeOnChanges: true,
      retentionDays: 30,
      staticHostingEnabled: false,
      buildCounter: 0,
    })
  })

  it('scopes project slugs per org', async () => {
    await createOrganization(t.db, { name: 'One', slug: 'one' })
    await createOrganization(t.db, { name: 'Two', slug: 'two' })
    await createProject(t.db, { orgSlug: 'one', name: 'web' })
    await createProject(t.db, { orgSlug: 'two', name: 'web' })
    await expect(createProject(t.db, { orgSlug: 'one', name: 'web' })).rejects.toBeInstanceOf(
      ConflictError,
    )
    await expect(createProject(t.db, { orgSlug: 'missing', name: 'web' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('rotates only the requested project token', async () => {
    await createOrganization(t.db, { name: 'Rotate', slug: 'rotate' })
    const a = await createProject(t.db, { orgSlug: 'rotate', name: 'a' })
    const b = await createProject(t.db, { orgSlug: 'rotate', name: 'b' })
    const rotated = await rotateProjectToken(t.db, { orgSlug: 'rotate', projectSlug: 'a' })
    expect(rotated.token).not.toBe(a.token)
    const projects = await listProjects(t.db, 'rotate')
    const byslug = Object.fromEntries(projects.map((p) => [p.slug, p]))
    expect(byslug.a?.tokenHash).toBe(hashToken(rotated.token))
    expect(byslug.b?.tokenHash).toBe(hashToken(b.token))
    await expect(
      rotateProjectToken(t.db, { orgSlug: 'rotate', projectSlug: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
