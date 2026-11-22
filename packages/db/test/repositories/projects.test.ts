import { projectColorFor, PROJECT_COLORS } from '@circi/core'
import { createTestDb, seedMember, seedProject, seedUser, seedWorkspace } from '@circi/db/testing'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConflictError, NotFoundError } from '#src/index.ts'
import {
  findProjectForMember,
  getProjectBySlugs,
  listProjects,
  projectSettings,
} from '#src/queries/index.ts'
import {
  createProject,
  setProjectAppearance,
  setProjectCiKey,
  updateProjectSettings,
} from '#src/repositories/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('projects', () => {
  it("creates a project with a derived slug and the plan's defaults", async () => {
    const { workspace } = await seedWorkspace(t.db)
    const project = await createProject(t.db, { workspaceSlug: workspace.slug, name: 'Web app' })
    expect(project).toMatchObject({
      slug: 'web-app',
      workspaceId: workspace.id,
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

  it('scopes project slugs per workspace', async () => {
    const one = await seedWorkspace(t.db)
    const two = await seedWorkspace(t.db)
    await createProject(t.db, { workspaceSlug: one.workspace.slug, name: 'web' })
    await createProject(t.db, { workspaceSlug: two.workspace.slug, name: 'web' })
    await expect(
      createProject(t.db, { workspaceSlug: one.workspace.slug, name: 'web' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      createProject(t.db, { workspaceSlug: 'missing', name: 'web' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects names that cannot become a valid slug', async () => {
    const { workspace } = await seedWorkspace(t.db)
    await expect(
      createProject(t.db, { workspaceSlug: workspace.slug, name: 'x', slug: 'admin' }),
    ).rejects.toThrow(/reserved/)
    await expect(
      createProject(t.db, { workspaceSlug: workspace.slug, name: '   ' }),
    ).rejects.toThrow(/required/)
  })

  it("lists a workspace's projects by slug", async () => {
    const { workspace } = await seedWorkspace(t.db)
    await createProject(t.db, { workspaceSlug: workspace.slug, name: 'b' })
    await createProject(t.db, { workspaceSlug: workspace.slug, name: 'a' })
    expect((await listProjects(t.db, workspace.slug)).map((p) => p.slug)).toEqual(['a', 'b'])
  })

  it('finds a project by its slugs, or says it does not exist', async () => {
    const { project, workspace } = await seedProject(t.db)
    expect(
      await getProjectBySlugs(t.db, { workspaceSlug: workspace.slug, projectSlug: project.slug }),
    ).toMatchObject({
      id: project.id,
    })
    await expect(
      getProjectBySlugs(t.db, { workspaceSlug: workspace.slug, projectSlug: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("records the project's current CI key, and clears it", async () => {
    const { project, workspace } = await seedProject(t.db)
    await t.client.query(
      `insert into apikey (id, reference_id, key, created_at, updated_at) values ('k1', '${workspace.id}', 'h', now(), now())`,
    )
    await setProjectCiKey(t.db, project.id, 'k1')
    expect(
      (await getProjectBySlugs(t.db, { workspaceSlug: workspace.slug, projectSlug: project.slug }))
        .ciKeyId,
    ).toBe('k1')
    await setProjectCiKey(t.db, project.id, null)
    expect(
      (await getProjectBySlugs(t.db, { workspaceSlug: workspace.slug, projectSlug: project.slug }))
        .ciKeyId,
    ).toBeNull()
  })
})

describe('findProjectForMember (workspace isolation)', () => {
  it('shows a project to members of its workspace only', async () => {
    const { project, workspace, owner } = await seedProject(t.db)
    const colleague = await seedMember(t.db, workspace.id)
    const outsider = await seedUser(t.db)
    const ask = (userId: string) =>
      findProjectForMember(t.db, {
        workspaceSlug: workspace.slug,
        projectSlug: project.slug,
        userId,
      })

    expect(await ask(owner.id)).toMatchObject({ id: project.id, workspaceSlug: workspace.slug })
    expect(await ask(colleague.id)).toMatchObject({ id: project.id })
    expect(await ask(outsider.id)).toBeUndefined()
  })

  it('answers the same for a project that does not exist', async () => {
    const { workspace, owner } = await seedProject(t.db)
    expect(
      await findProjectForMember(t.db, {
        workspaceSlug: workspace.slug,
        projectSlug: 'nope',
        userId: owner.id,
      }),
    ).toBeUndefined()
  })

  it('does not leak a project across workspaces that share a slug', async () => {
    const a = await seedProject(t.db)
    const b = await seedProject(t.db)
    expect(a.project.slug).toBe(b.project.slug)
    expect(
      await findProjectForMember(t.db, {
        workspaceSlug: b.workspace.slug,
        projectSlug: b.project.slug,
        userId: a.owner.id,
      }),
    ).toBeUndefined()
  })
})

describe('flaky-screenshot setting', () => {
  it('starts as null: the project inherits the workspace', async () => {
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

  it('renames the slug: valid, free in the workspace, and the old address stops resolving', async () => {
    const { project, workspace } = await seedProject(t.db, { slug: 'old-name' })
    await createProject(t.db, { workspaceSlug: workspace.slug, name: 'Taken', slug: 'taken' })
    expect(project.slug).toBe('old-name')
    expect((await updateProjectSettings(t.db, project.id, { slug: ' fresh ' })).slug).toBe('fresh')
    expect((await updateProjectSettings(t.db, project.id, { retentionDays: 7 })).slug).toBe('fresh')
    await expect(updateProjectSettings(t.db, project.id, { slug: 'taken' })).rejects.toThrow(
      /already taken/,
    )
    await expect(updateProjectSettings(t.db, project.id, { slug: 'Not Valid!' })).rejects.toThrow(
      /slug/,
    )
    // The same slug in another workspace is fine.
    const other = await seedProject(t.db, { slug: 'elsewhere' })
    expect((await updateProjectSettings(t.db, other.project.id, { slug: 'fresh' })).slug).toBe(
      'fresh',
    )
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

  it('gives a new project a colour from its name and no icon, unless it chooses', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const auto = await createProject(t.db, { workspaceSlug: workspace.slug, name: 'Checkout' })
    expect(auto).toMatchObject({ color: projectColorFor('Checkout'), icon: null })
    const chosen = await createProject(t.db, {
      workspaceSlug: workspace.slug,
      name: 'Docs',
      color: 'plum',
      icon: 'book-open',
    })
    expect(chosen).toMatchObject({ color: 'plum', icon: 'book-open' })
    await expect(
      createProject(t.db, { workspaceSlug: workspace.slug, name: 'x1', color: 'red' }),
    ).rejects.toThrow(/Colour must be/)
    await expect(
      createProject(t.db, { workspaceSlug: workspace.slug, name: 'x2', icon: 'not-an-icon' }),
    ).rejects.toThrow(/Unknown icon/)
    expect(PROJECT_COLORS).toContain(auto.color)
  })

  it('changes colour and icon separately, clears the icon with null, and validates both', async () => {
    const { project } = await seedProject(t.db)
    expect(await setProjectAppearance(t.db, project.id, { icon: 'rocket' })).toEqual({
      color: project.color,
      icon: 'rocket',
    })
    expect(await setProjectAppearance(t.db, project.id, { color: 'moss' })).toEqual({
      color: 'moss',
      icon: 'rocket',
    })
    expect(await setProjectAppearance(t.db, project.id, { icon: null })).toEqual({
      color: 'moss',
      icon: null,
    })
    expect(await setProjectAppearance(t.db, project.id, {})).toEqual({ color: 'moss', icon: null })
    await expect(setProjectAppearance(t.db, project.id, { color: 'pink' })).rejects.toThrow(
      /Colour/,
    )
    await expect(setProjectAppearance(t.db, project.id, { icon: 'nope' })).rejects.toThrow(/icon/)
    await expect(
      setProjectAppearance(t.db, '00000000-0000-4000-8000-000000000000', { color: 'plum' }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses a colour outside the palette at the database too', async () => {
    const { project } = await seedProject(t.db)
    await expect(
      t.db.execute(sql`update projects set color = 'red' where id = ${project.id}`),
    ).rejects.toThrow(/projects_color_check|color/)
  })
})
