import { teamColorFor, TEAM_COLORS } from '@circi/core'
import { addTestMember, createTestDb, seedWorkspace, seedTeam, seedUser } from '@circi/testing'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ConflictError,
  createTeam,
  findTeamForMember,
  getTeamBySlugs,
  listTeams,
  NotFoundError,
  teamSettings,
  setTeamAppearance,
  setTeamCiKey,
  updateTeamSettings,
} from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('teams', () => {
  it('creates a team with a derived slug and the plan’s defaults', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const team = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'Web app' })
    expect(team).toMatchObject({
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

  it('scopes team slugs per workspace', async () => {
    const one = await seedWorkspace(t.db)
    const two = await seedWorkspace(t.db)
    await createTeam(t.db, { workspaceSlug: one.workspace.slug, name: 'web' })
    await createTeam(t.db, { workspaceSlug: two.workspace.slug, name: 'web' })
    await expect(
      createTeam(t.db, { workspaceSlug: one.workspace.slug, name: 'web' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      createTeam(t.db, { workspaceSlug: 'missing', name: 'web' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects names that cannot become a valid slug', async () => {
    const { workspace } = await seedWorkspace(t.db)
    await expect(
      createTeam(t.db, { workspaceSlug: workspace.slug, name: 'x', slug: 'admin' }),
    ).rejects.toThrow(/reserved/)
    await expect(createTeam(t.db, { workspaceSlug: workspace.slug, name: '   ' })).rejects.toThrow(
      /required/,
    )
  })

  it('lists a workspace’s teams by slug', async () => {
    const { workspace } = await seedWorkspace(t.db)
    await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'b' })
    await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'a' })
    expect((await listTeams(t.db, workspace.slug)).map((p) => p.slug)).toEqual(['a', 'b'])
  })

  it('finds a team by its slugs, or says it does not exist', async () => {
    const { team, workspace } = await seedTeam(t.db)
    expect(
      await getTeamBySlugs(t.db, { workspaceSlug: workspace.slug, teamSlug: team.slug }),
    ).toMatchObject({
      id: team.id,
    })
    await expect(
      getTeamBySlugs(t.db, { workspaceSlug: workspace.slug, teamSlug: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('records the team’s current CI key, and clears it', async () => {
    const { team, workspace } = await seedTeam(t.db)
    await t.client.query(
      `insert into apikey (id, reference_id, key, created_at, updated_at) values ('k1', '${workspace.id}', 'h', now(), now())`,
    )
    await setTeamCiKey(t.db, team.id, 'k1')
    expect(
      (await getTeamBySlugs(t.db, { workspaceSlug: workspace.slug, teamSlug: team.slug })).ciKeyId,
    ).toBe('k1')
    await setTeamCiKey(t.db, team.id, null)
    expect(
      (await getTeamBySlugs(t.db, { workspaceSlug: workspace.slug, teamSlug: team.slug })).ciKeyId,
    ).toBeNull()
  })
})

describe('findTeamForMember (workspace isolation)', () => {
  it('shows a team to members of its workspace only', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const colleague = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: colleague.id })
    const outsider = await seedUser(t.db)
    const ask = (userId: string) =>
      findTeamForMember(t.db, { workspaceSlug: workspace.slug, teamSlug: team.slug, userId })

    expect(await ask(owner.id)).toMatchObject({ id: team.id, workspaceSlug: workspace.slug })
    expect(await ask(colleague.id)).toMatchObject({ id: team.id })
    expect(await ask(outsider.id)).toBeUndefined()
  })

  it('answers the same for a team that does not exist', async () => {
    const { workspace, owner } = await seedTeam(t.db)
    expect(
      await findTeamForMember(t.db, {
        workspaceSlug: workspace.slug,
        teamSlug: 'nope',
        userId: owner.id,
      }),
    ).toBeUndefined()
  })

  it('does not leak a team across workspaces that share a slug', async () => {
    const a = await seedTeam(t.db)
    const b = await seedTeam(t.db)
    expect(a.team.slug).toBe(b.team.slug)
    expect(
      await findTeamForMember(t.db, {
        workspaceSlug: b.workspace.slug,
        teamSlug: b.team.slug,
        userId: a.owner.id,
      }),
    ).toBeUndefined()
  })
})

describe('flaky-screenshot setting', () => {
  it('starts as null: the team inherits the workspace', async () => {
    const { team } = await seedTeam(t.db)
    expect(teamSettings(team).flakyBlocksMerge).toBeNull()
  })

  it('is set to on or off, and back to null to inherit again; other patches leave it be', async () => {
    const { team } = await seedTeam(t.db)
    expect(
      (await updateTeamSettings(t.db, team.id, { flakyBlocksMerge: false })).flakyBlocksMerge,
    ).toBe(false)
    expect((await updateTeamSettings(t.db, team.id, { retentionDays: 7 })).flakyBlocksMerge).toBe(
      false,
    )
    expect(
      (await updateTeamSettings(t.db, team.id, { flakyBlocksMerge: true })).flakyBlocksMerge,
    ).toBe(true)
    expect(
      (await updateTeamSettings(t.db, team.id, { flakyBlocksMerge: null })).flakyBlocksMerge,
    ).toBeNull()
  })

  it('has a 24 hour review target that can be changed, cleared with null, and must be positive', async () => {
    const { team } = await seedTeam(t.db)
    expect(teamSettings(team).reviewTargetHours).toBe(24)
    expect(
      (await updateTeamSettings(t.db, team.id, { reviewTargetHours: 4 })).reviewTargetHours,
    ).toBe(4)
    expect((await updateTeamSettings(t.db, team.id, { retentionDays: 7 })).reviewTargetHours).toBe(
      4,
    )
    expect(
      (await updateTeamSettings(t.db, team.id, { reviewTargetHours: null })).reviewTargetHours,
    ).toBeNull()
    await expect(updateTeamSettings(t.db, team.id, { reviewTargetHours: 0 })).rejects.toThrow(
      /review target/,
    )
  })

  it('gives a new team a colour from its name and no icon, unless it chooses', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const auto = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'Checkout' })
    expect(auto).toMatchObject({ color: teamColorFor('Checkout'), icon: null })
    const chosen = await createTeam(t.db, {
      workspaceSlug: workspace.slug,
      name: 'Docs',
      color: 'plum',
      icon: 'book-open',
    })
    expect(chosen).toMatchObject({ color: 'plum', icon: 'book-open' })
    await expect(
      createTeam(t.db, { workspaceSlug: workspace.slug, name: 'x1', color: 'red' }),
    ).rejects.toThrow(/Colour must be/)
    await expect(
      createTeam(t.db, { workspaceSlug: workspace.slug, name: 'x2', icon: 'trash' }),
    ).rejects.toThrow(/Unknown icon/)
    expect(TEAM_COLORS).toContain(auto.color)
  })

  it('changes colour and icon separately, clears the icon with null, and validates both', async () => {
    const { team } = await seedTeam(t.db)
    expect(await setTeamAppearance(t.db, team.id, { icon: 'rocket' })).toEqual({
      color: team.color,
      icon: 'rocket',
    })
    expect(await setTeamAppearance(t.db, team.id, { color: 'moss' })).toEqual({
      color: 'moss',
      icon: 'rocket',
    })
    expect(await setTeamAppearance(t.db, team.id, { icon: null })).toEqual({
      color: 'moss',
      icon: null,
    })
    expect(await setTeamAppearance(t.db, team.id, {})).toEqual({ color: 'moss', icon: null })
    await expect(setTeamAppearance(t.db, team.id, { color: 'pink' })).rejects.toThrow(/Colour/)
    await expect(setTeamAppearance(t.db, team.id, { icon: 'nope' })).rejects.toThrow(/icon/)
    await expect(
      setTeamAppearance(t.db, '00000000-0000-4000-8000-000000000000', { color: 'plum' }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses a colour outside the palette at the database too', async () => {
    const { team } = await seedTeam(t.db)
    await expect(
      t.db.execute(sql`update teams set color = 'red' where id = ${team.id}`),
    ).rejects.toThrow(/teams_color_check|color/)
  })
})
