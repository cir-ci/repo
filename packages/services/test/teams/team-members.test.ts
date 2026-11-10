import { ForbiddenError, NotFoundError, ValidationError } from '@circi/core'
import {
  getTriageRotation,
  isTeamMember,
  listReviewRules,
  listTeamMembers,
} from '@circi/db/queries'
import {
  addTestMember,
  addTestTeamMember,
  createTestDb,
  seedBuild,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  type Actor,
  addMembersToTeam,
  addReviewRule,
  editReviewRule,
  removeMemberFromTeam,
  removeMemberFromWorkspaceTeams,
  replaceTriageRotation,
  requestReview,
  assignTriage,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const actor = (userId: string, role: string, teamMember: boolean): Actor => ({
  userId,
  instanceAdmin: false,
  role,
  teamMember,
})

/** An owner, an admin outside the team, a member of the team and a member who is not in it. */
async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const admin = await seedUser(t.db)
  const ann = await seedUser(t.db)
  const bob = await seedUser(t.db)
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: admin.id,
    role: 'admin',
    teams: [],
  })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id, teams: [team.id] })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: bob.id, teams: [] })
  return {
    team,
    workspace,
    owner,
    admin,
    ann,
    bob,
    asOwner: actor(owner.id, 'owner', true),
    asAdmin: actor(admin.id, 'admin', false),
    asAnn: actor(ann.id, 'member', true),
    asBob: actor(bob.id, 'member', false),
  }
}

describe('addMembersToTeam', () => {
  it('lets owners and admins add anyone, themselves included, and ignores someone already in', async () => {
    const { team, admin, ann, bob, asOwner, asAdmin } = await setup()
    expect(
      await addMembersToTeam(t.db, { actor: asOwner, teamId: team.id, userIds: [bob.id, ann.id] }),
    ).toEqual([bob.id])
    expect(
      await addMembersToTeam(t.db, { actor: asAdmin, teamId: team.id, userIds: [admin.id] }),
    ).toEqual([admin.id])
    expect(await isTeamMember(t.db, team.id, admin.id)).toBe(true)
  })

  it('refuses a member (403), and answers a member who cannot see the team as for a missing one (404)', async () => {
    const { team, bob, asAnn, asBob } = await setup()
    await expect(
      addMembersToTeam(t.db, { actor: asAnn, teamId: team.id, userIds: [bob.id] }),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      addMembersToTeam(t.db, { actor: asBob, teamId: team.id, userIds: [bob.id] }),
    ).rejects.toThrow(NotFoundError)
    expect(await isTeamMember(t.db, team.id, bob.id)).toBe(false)
  })

  it('refuses people who are not in the workspace, adding nobody', async () => {
    const { team, bob, asOwner } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      addMembersToTeam(t.db, { actor: asOwner, teamId: team.id, userIds: [bob.id, stranger.id] }),
    ).rejects.toThrow(ValidationError)
    expect(await isTeamMember(t.db, team.id, bob.id)).toBe(false)
  })
})

describe('removeMemberFromTeam', () => {
  it('lets owners and admins remove anyone, and a member remove only themselves', async () => {
    const { team, owner, ann, asAdmin, asAnn } = await setup()
    await expect(
      removeMemberFromTeam(t.db, { actor: asAnn, teamId: team.id, userId: owner.id }),
    ).rejects.toThrow(ForbiddenError)
    expect(
      await removeMemberFromTeam(t.db, { actor: asAdmin, teamId: team.id, userId: owner.id }),
    ).toBe(true)
    expect(
      await removeMemberFromTeam(t.db, { actor: asAnn, teamId: team.id, userId: ann.id }),
    ).toBe(true)
    // The last members are gone; an empty team is allowed, and removing again does nothing.
    expect(await listTeamMembers(t.db, team.id)).toEqual([])
    expect(
      await removeMemberFromTeam(t.db, { actor: asAdmin, teamId: team.id, userId: ann.id }),
    ).toBe(false)
  })

  it('does not let a member of no part of the team remove anyone: 404', async () => {
    const { team, ann, asBob } = await setup()
    await expect(
      removeMemberFromTeam(t.db, { actor: asBob, teamId: team.id, userId: ann.id }),
    ).rejects.toThrow(NotFoundError)
  })

  it('takes the person off the rules and the rotation in the same change, keeping past requests', async () => {
    const { team, owner, ann, asAnn } = await setup()
    await addReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'a/**',
      reviewerIds: [ann.id, owner.id],
    })
    await replaceTriageRotation(t.db, { teamId: team.id, memberIds: [owner.id, ann.id] })
    await assignTriage(t.db, {
      teamId: team.id,
      kind: 'flaky',
      key: 'home',
      assigneeId: ann.id,
    })
    const build = await seedBuild(t.db, team.id, { branch: 'feature' })
    await requestReview(t.db, { buildId: build.id, reviewerId: ann.id, requestedById: owner.id })

    await removeMemberFromTeam(t.db, { actor: asAnn, teamId: team.id, userId: ann.id })

    expect((await listReviewRules(t.db, team.id))[0]?.reviewers.map((r) => r.id)).toEqual([
      owner.id,
    ])
    expect((await getTriageRotation(t.db, team.id)).members.map((m) => m.id)).toEqual([owner.id])
    const requests = await t.db.query.reviewRequests.findMany()
    expect(requests.filter((r) => r.reviewerId === ann.id)).toHaveLength(1)
  })
})

describe('removeMemberFromWorkspaceTeams', () => {
  it('takes the person out of every team of the workspace', async () => {
    const { team, workspace, owner, ann } = await setup()
    const second = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'docs' })
    await addTestTeamMember(t.db, { teamId: second.team.id, userId: ann.id })
    await removeMemberFromWorkspaceTeams(t.db, { workspaceId: workspace.id, userId: ann.id })
    expect(await isTeamMember(t.db, team.id, ann.id)).toBe(false)
    expect(await isTeamMember(t.db, second.team.id, ann.id)).toBe(false)
  })
})

describe('who can be picked', () => {
  it('accepts only team members as rule reviewers, rotation members, assignees and requested reviewers', async () => {
    const { team, owner, bob } = await setup()
    // Bob belongs to the workspace and not to the team.
    await expect(
      addReviewRule(t.db, {
        teamId: team.id,
        kind: 'snapshot-name',
        pattern: 'x',
        reviewerIds: [bob.id],
      }),
    ).rejects.toThrow(/members of this team/)
    const rule = await addReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'x',
      reviewerIds: [owner.id],
    })
    await expect(
      editReviewRule(t.db, {
        teamId: team.id,
        id: rule.id,
        kind: 'snapshot-name',
        pattern: 'x',
        reviewerIds: [bob.id],
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      replaceTriageRotation(t.db, { teamId: team.id, memberIds: [bob.id] }),
    ).rejects.toThrow(/member of this team/)
    await expect(
      assignTriage(t.db, { teamId: team.id, kind: 'flaky', key: 'home', assigneeId: bob.id }),
    ).rejects.toThrow(ValidationError)
    const build = await seedBuild(t.db, team.id, { branch: 'feature' })
    await expect(
      requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id }),
    ).rejects.toThrow(/must be a member of this team/)
  })
})
