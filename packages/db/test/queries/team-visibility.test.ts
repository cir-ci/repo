import {
  addTestMember,
  addTestTeamMember,
  createTestDb,
  seedBuild,
  seedNotification,
  seedReviewRequest,
  seedScreenshot,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  canUserAccessFile,
  getSidebar,
  listBranches,
  listBuildsForWorkspace,
  listInbox,
  listReviewRequests,
  listTeamsOverview,
  listWorkspaceTeamMappings,
  searchWorkspace,
} from '#src/queries/index.ts'
import { createTeam } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const now = new Date('2026-03-10T12:00:00.000Z')

/**
 * A workspace with two teams: `open` (everyone below is in it) and `secret` (only `insider`, and
 * the owner and the admin who see everything). `outsider` is a plain member of neither.
 */
async function setup() {
  const first = await seedTeam(t.db, { slug: 'open' })
  const { workspace, owner } = first
  const secret = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'secret' })
  const admin = await seedUser(t.db)
  const insider = await seedUser(t.db)
  const outsider = await seedUser(t.db)
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: admin.id,
    role: 'admin',
    teams: [],
  })
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: insider.id,
    teams: [first.team.id, secret.id],
  })
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: outsider.id,
    teams: [first.team.id],
  })
  await addTestTeamMember(t.db, { teamId: secret.id, userId: owner.id })
  const openBuild = await seedBuild(t.db, first.team.id, { branch: 'feature-open' })
  const secretBuild = await seedBuild(t.db, secret.id, { branch: 'feature-secret' })
  return {
    workspace,
    owner,
    admin,
    insider,
    outsider,
    open: first.team,
    secret,
    openBuild,
    secretBuild,
  }
}

describe('what each person sees of a team they are not in', () => {
  it('lists the teams in the sidebar and the overview for members, and all for owners and admins', async () => {
    const s = await setup()
    const slugs = async (userId: string) =>
      (await getSidebar(t.db, { userId, workspace: s.workspace, now })).teams
        .map((x) => x.slug)
        .toSorted()
    expect(await slugs(s.outsider.id)).toEqual(['open'])
    expect(await slugs(s.insider.id)).toEqual(['open', 'secret'])
    expect(await slugs(s.admin.id)).toEqual(['open', 'secret'])
    const bar = await getSidebar(t.db, { userId: s.admin.id, workspace: s.workspace, now })
    expect(bar.teams.find((x) => x.slug === 'secret')).toMatchObject({
      memberCount: 2,
      youAreMember: false,
    })
    expect(bar.teams.find((x) => x.slug === 'open')).toMatchObject({
      memberCount: 3,
      youAreMember: false,
    })

    const overview = async (userId: string) =>
      (await listTeamsOverview(t.db, userId)).map((x) => x.team.slug).toSorted()
    expect(await overview(s.outsider.id)).toEqual(['open'])
    expect(await overview(s.admin.id)).toEqual(['open', 'secret'])
  })

  it('leaves the team out of search, branches and the workspace build list', async () => {
    const s = await setup()
    const search = (userId: string, query: string) =>
      searchWorkspace(t.db, { userId, workspaceSlug: s.workspace.slug, query })
    expect((await search(s.outsider.id, 'secret'))?.teams).toEqual([])
    expect((await search(s.insider.id, 'secret'))?.teams.map((x) => x.slug)).toEqual(['secret'])
    expect((await search(s.outsider.id, 'feature-secret'))?.branches).toEqual([])
    expect((await search(s.admin.id, 'feature-secret'))?.branches).toHaveLength(1)

    const branches = (userId: string) =>
      listBranches(t.db, { userId, workspaceSlug: s.workspace.slug })
    expect((await branches(s.outsider.id))?.map((b) => b.name)).toEqual(['feature-open'])
    expect((await branches(s.insider.id))?.map((b) => b.name).toSorted()).toEqual([
      'feature-open',
      'feature-secret',
    ])
    expect(
      await listBranches(t.db, {
        userId: s.outsider.id,
        workspaceSlug: s.workspace.slug,
        teamSlug: 'secret',
      }),
    ).toBeUndefined()

    const list = async (userId: string) =>
      (
        await listBuildsForWorkspace(t.db, { userId, workspaceSlug: s.workspace.slug, limit: 50 })
      )?.builds.map((b) => b.team.slug)
    expect(await list(s.outsider.id)).toEqual(['open'])
    expect((await list(s.admin.id))?.toSorted()).toEqual(['open', 'secret'])
  })

  it('keeps notifications, review requests and files of the team from people who cannot see it', async () => {
    const s = await setup()
    await seedNotification(t.db, {
      userId: s.outsider.id,
      kind: 'mentioned',
      buildId: s.secretBuild.id,
    })
    await seedNotification(t.db, {
      userId: s.outsider.id,
      kind: 'mentioned',
      buildId: s.openBuild.id,
    })
    const inbox = await listInbox(t.db, { userId: s.outsider.id, tab: 'everything', now })
    expect(inbox.items.map((i) => i.team?.slug)).toEqual(['open'])

    await seedReviewRequest(t.db, { buildId: s.secretBuild.id, reviewerId: s.outsider.id })
    await seedReviewRequest(t.db, { buildId: s.secretBuild.id, reviewerId: s.insider.id })
    const requests = (userId: string) => listReviewRequests(t.db, { userId, tab: 'all-open', now })
    expect(await requests(s.outsider.id)).toEqual([])
    expect(await requests(s.insider.id)).toHaveLength(2)

    const sha = 'f'.repeat(64)
    await seedScreenshot(t.db, { buildId: s.secretBuild.id, fileSha256: sha })
    expect(await canUserAccessFile(t.db, s.outsider.id, sha)).toBe(false)
    expect(await canUserAccessFile(t.db, s.insider.id, sha)).toBe(true)
    expect(await canUserAccessFile(t.db, s.admin.id, sha)).toBe(true)
  })

  it('lists only visible teams on an integration', async () => {
    const s = await setup()
    // The mapping read model takes the integration id; none is needed to list teams.
    const none = '00000000-0000-4000-8000-000000000000'
    const rows = (userId: string) => listWorkspaceTeamMappings(t.db, s.workspace.id, none, userId)
    expect((await rows(s.outsider.id)).map((r) => r.slug)).toEqual(['open'])
    expect((await rows(s.admin.id)).map((r) => r.slug).toSorted()).toEqual(['open', 'secret'])
  })
})
