import { addTestMember, createTestDb, seedOrg, seedProject, seedUser } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ConflictError,
  createProject,
  findProjectForMember,
  getProjectBySlugs,
  listProjects,
  NotFoundError,
  projectSettings,
  setProjectCiKey,
  updateProjectSettings,
} from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('projects', () => {
  it('creates a project with a derived slug and the plan’s defaults', async () => {
    const { org } = await seedOrg(t.db)
    const project = await createProject(t.db, { orgSlug: org.slug, name: 'Web app' })
    expect(project).toMatchObject({
      slug: 'web-app',
      orgId: org.id,
      defaultBranch: 'main',
      diffThreshold: 0,
      autoApproveDefaultBranch: true,
      blockMergeOnChanges: true,
      retentionDays: 30,
      reviewTargetHours: 24,
      staticHostingEnabled: false,
      buildCounter: 0,
      ciKeyId: null,
    })
  })

  it('scopes project slugs per organization', async () => {
    const one = await seedOrg(t.db)
    const two = await seedOrg(t.db)
    await createProject(t.db, { orgSlug: one.org.slug, name: 'web' })
    await createProject(t.db, { orgSlug: two.org.slug, name: 'web' })
    await expect(
      createProject(t.db, { orgSlug: one.org.slug, name: 'web' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(createProject(t.db, { orgSlug: 'missing', name: 'web' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('rejects names that cannot become a valid slug', async () => {
    const { org } = await seedOrg(t.db)
    await expect(
      createProject(t.db, { orgSlug: org.slug, name: 'x', slug: 'admin' }),
    ).rejects.toThrow(/reserved/)
    await expect(createProject(t.db, { orgSlug: org.slug, name: '   ' })).rejects.toThrow(
      /required/,
    )
  })

  it('lists an organization’s projects by slug', async () => {
    const { org } = await seedOrg(t.db)
    await createProject(t.db, { orgSlug: org.slug, name: 'b' })
    await createProject(t.db, { orgSlug: org.slug, name: 'a' })
    expect((await listProjects(t.db, org.slug)).map((p) => p.slug)).toEqual(['a', 'b'])
  })

  it('finds a project by its slugs, or says it does not exist', async () => {
    const { project, org } = await seedProject(t.db)
    expect(
      await getProjectBySlugs(t.db, { orgSlug: org.slug, projectSlug: project.slug }),
    ).toMatchObject({
      id: project.id,
    })
    await expect(
      getProjectBySlugs(t.db, { orgSlug: org.slug, projectSlug: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('records the project’s current CI key, and clears it', async () => {
    const { project, org } = await seedProject(t.db)
    await t.client.query(
      `insert into apikey (id, reference_id, key, created_at, updated_at) values ('k1', '${org.id}', 'h', now(), now())`,
    )
    await setProjectCiKey(t.db, project.id, 'k1')
    expect(
      (await getProjectBySlugs(t.db, { orgSlug: org.slug, projectSlug: project.slug })).ciKeyId,
    ).toBe('k1')
    await setProjectCiKey(t.db, project.id, null)
    expect(
      (await getProjectBySlugs(t.db, { orgSlug: org.slug, projectSlug: project.slug })).ciKeyId,
    ).toBeNull()
  })
})

describe('findProjectForMember (organization isolation)', () => {
  it('shows a project to members of its organization only', async () => {
    const { project, org, owner } = await seedProject(t.db)
    const colleague = await seedUser(t.db)
    await addTestMember(t.db, { orgId: org.id, userId: colleague.id })
    const outsider = await seedUser(t.db)
    const ask = (userId: string) =>
      findProjectForMember(t.db, { orgSlug: org.slug, projectSlug: project.slug, userId })

    expect(await ask(owner.id)).toMatchObject({ id: project.id, orgSlug: org.slug })
    expect(await ask(colleague.id)).toMatchObject({ id: project.id })
    expect(await ask(outsider.id)).toBeUndefined()
  })

  it('answers the same for a project that does not exist', async () => {
    const { org, owner } = await seedProject(t.db)
    expect(
      await findProjectForMember(t.db, {
        orgSlug: org.slug,
        projectSlug: 'nope',
        userId: owner.id,
      }),
    ).toBeUndefined()
  })

  it('does not leak a project across organizations that share a slug', async () => {
    const a = await seedProject(t.db)
    const b = await seedProject(t.db)
    expect(a.project.slug).toBe(b.project.slug)
    expect(
      await findProjectForMember(t.db, {
        orgSlug: b.org.slug,
        projectSlug: b.project.slug,
        userId: a.owner.id,
      }),
    ).toBeUndefined()
  })
})

describe('flaky-screenshot setting', () => {
  it('starts as null: the project inherits the organization', async () => {
    const { project } = await seedProject(t.db)
    expect(projectSettings(project).flakyBlocksMerge).toBeNull()
  })

  it('is set to on or off, and back to null to inherit again; other patches leave it be', async () => {
    const { project } = await seedProject(t.db)
    expect(
      (await updateProjectSettings(t.db, project.id, { flakyBlocksMerge: false })).flakyBlocksMerge,
    ).toBe(false)
    expect(
      (await updateProjectSettings(t.db, project.id, { retentionDays: 7 })).flakyBlocksMerge,
    ).toBe(false)
    expect(
      (await updateProjectSettings(t.db, project.id, { flakyBlocksMerge: true })).flakyBlocksMerge,
    ).toBe(true)
    expect(
      (await updateProjectSettings(t.db, project.id, { flakyBlocksMerge: null })).flakyBlocksMerge,
    ).toBeNull()
  })

  it('has a 24 hour review target that can be changed, cleared with null, and must be positive', async () => {
    const { project } = await seedProject(t.db)
    expect(projectSettings(project).reviewTargetHours).toBe(24)
    expect(
      (await updateProjectSettings(t.db, project.id, { reviewTargetHours: 4 })).reviewTargetHours,
    ).toBe(4)
    expect(
      (await updateProjectSettings(t.db, project.id, { retentionDays: 7 })).reviewTargetHours,
    ).toBe(4)
    expect(
      (await updateProjectSettings(t.db, project.id, { reviewTargetHours: null }))
        .reviewTargetHours,
    ).toBeNull()
    await expect(updateProjectSettings(t.db, project.id, { reviewTargetHours: 0 })).rejects.toThrow(
      /review target/,
    )
  })
})
