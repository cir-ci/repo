import { ValidationError } from '@circi/core'
import {
  addTestMember,
  addTestTeamMember,
  createTestDb,
  seedAccount,
  seedBuild,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  findTeamForMember,
  getTeamMemberSummaries,
  isTeamMember,
  listTeamMembers,
  listWorkspaceMemberTeams,
} from '#src/queries/index.ts'
import {
  addTeamMembers,
  findMembersByAccount,
  findTeamViewersByAccount,
  createReviewRule,
  createTeam,
  openReviewRequest,
  removeTeamMember,
  removeUserFromWorkspaceTeams,
  setTriageRotation,
  assignTriageItem,
} from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** A workspace with an owner, an admin, two plain members and a team nobody but the owner is in. */
async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const people = {
    admin: await seedUser(t.db),
    ann: await seedUser(t.db),
    bob: await seedUser(t.db),
  }
  // Added after the team, and with no team, as an invited person would be.
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: people.admin.id,
    role: 'admin',
    teams: [],
  })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: people.ann.id, teams: [] })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: people.bob.id, teams: [] })
  return { team, workspace, owner, ...people }
}

describe('addTeamMembers', () => {
  it('adds workspace members, once each, and says who was new', async () => {
    const { team, owner, ann, bob } = await setup()
    expect(
      await addTeamMembers(t.db, { teamId: team.id, userIds: [ann.id, ann.id], addedBy: owner.id }),
    ).toEqual([ann.id])
    expect(
      (
        await addTeamMembers(t.db, {
          teamId: team.id,
          userIds: [ann.id, bob.id],
          addedBy: owner.id,
        })
      ).toSorted(),
    ).toEqual([bob.id])
    expect((await listTeamMembers(t.db, team.id)).map((m) => m.id).toSorted()).toEqual(
      [owner.id, ann.id, bob.id].toSorted(),
    )
    const [row] = await t.db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, bob.id))
    expect(row?.addedBy).toBe(owner.id)
  })

  it('refuses people outside the workspace, and adds nobody then', async () => {
    const { team, ann } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      addTeamMembers(t.db, { teamId: team.id, userIds: [ann.id, stranger.id], addedBy: null }),
    ).rejects.toThrow(ValidationError)
    expect(await isTeamMember(t.db, team.id, ann.id)).toBe(false)
  })

  it('does nothing for an empty list', async () => {
    const { team } = await setup()
    expect(await addTeamMembers(t.db, { teamId: team.id, userIds: [], addedBy: null })).toEqual([])
  })
})

describe('createTeam members', () => {
  it('adds the creator and the given workspace members', async () => {
    const { workspace, owner, ann, bob } = await setup()
    const team = await createTeam(t.db, {
      workspaceSlug: workspace.slug,
      name: 'docs',
      createdBy: owner.id,
      memberIds: [ann.id, owner.id],
    })
    expect((await listTeamMembers(t.db, team.id)).map((m) => m.id).toSorted()).toEqual(
      [owner.id, ann.id].toSorted(),
    )
    expect(await isTeamMember(t.db, team.id, bob.id)).toBe(false)
  })

  it('starts empty when nobody is named, and refuses non-members without creating the team', async () => {
    const { workspace } = await setup()
    const empty = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'empty' })
    expect(await listTeamMembers(t.db, empty.id)).toEqual([])
    const stranger = await seedUser(t.db)
    await expect(
      createTeam(t.db, { workspaceSlug: workspace.slug, name: 'nope', memberIds: [stranger.id] }),
    ).rejects.toThrow(ValidationError)
    const slugs = await t.db
      .select({ slug: schema.teams.slug })
      .from(schema.teams)
      .where(eq(schema.teams.workspaceId, workspace.id))
    expect(slugs.map((s) => s.slug)).not.toContain('nope')
  })
})

describe('removeTeamMember', () => {
  it('takes the person off the rules, the rotation and their assigned items, and keeps what happened', async () => {
    const { team, owner, ann } = await setup()
    await addTeamMembers(t.db, { teamId: team.id, userIds: [ann.id], addedBy: owner.id })
    const rule = await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'a/**',
      reviewerIds: [ann.id, owner.id],
    })
    await setTriageRotation(t.db, { teamId: team.id, memberIds: [ann.id, owner.id] })
    await assignTriageItem(t.db, {
      teamId: team.id,
      kind: 'flaky',
      key: 'home',
      assigneeId: ann.id,
    })
    const build = await seedBuild(t.db, team.id, { branch: 'feature' })
    await openReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: ann.id,
      requestedById: owner.id,
      dueAt: null,
    })

    expect(await removeTeamMember(t.db, { teamId: team.id, userId: ann.id })).toBe(true)

    expect(await isTeamMember(t.db, team.id, ann.id)).toBe(false)
    const reviewers = await t.db
      .select()
      .from(schema.reviewRuleReviewers)
      .where(eq(schema.reviewRuleReviewers.ruleId, rule.id))
    expect(reviewers.map((r) => r.userId)).toEqual([owner.id])
    const rotation = await t.db.select().from(schema.triageRotationMembers)
    expect(rotation.filter((r) => r.teamId === team.id).map((r) => r.userId)).toEqual([owner.id])
    const [item] = await t.db
      .select()
      .from(schema.triageItems)
      .where(eq(schema.triageItems.teamId, team.id))
    expect(item?.assigneeId).toBeNull()
    // The request stays, as does everything else in the past.
    const requests = await t.db
      .select()
      .from(schema.reviewRequests)
      .where(eq(schema.reviewRequests.reviewerId, ann.id))
    expect(requests).toHaveLength(1)
  })

  it('switches the rotation off when its last person goes', async () => {
    const { team, owner } = await setup()
    await setTriageRotation(t.db, { teamId: team.id, memberIds: [owner.id] })
    await removeTeamMember(t.db, { teamId: team.id, userId: owner.id })
    const [row] = await t.db.select().from(schema.teams).where(eq(schema.teams.id, team.id))
    expect(row?.triageRotationStartsOn).toBeNull()
  })

  it('allows removing the last member, and says false for someone who was not in', async () => {
    const { team, owner, bob } = await setup()
    expect(await removeTeamMember(t.db, { teamId: team.id, userId: bob.id })).toBe(false)
    expect(await removeTeamMember(t.db, { teamId: team.id, userId: owner.id })).toBe(true)
    expect(await listTeamMembers(t.db, team.id)).toEqual([])
  })
})

describe('removeUserFromWorkspaceTeams', () => {
  it('takes the person out of every team of the workspace, and only that workspace', async () => {
    const { team, workspace, owner, ann } = await setup()
    const second = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'second' })
    await addTeamMembers(t.db, { teamId: team.id, userIds: [ann.id], addedBy: owner.id })
    await addTeamMembers(t.db, { teamId: second.id, userIds: [ann.id], addedBy: owner.id })
    const rule = await createReviewRule(t.db, {
      teamId: second.id,
      kind: 'snapshot-name',
      pattern: 'a/**',
      reviewerIds: [ann.id],
    })
    const other = await seedTeam(t.db)
    await addTestMember(t.db, { workspaceId: other.workspace.id, userId: ann.id })

    await removeUserFromWorkspaceTeams(t.db, { workspaceId: workspace.id, userId: ann.id })

    expect(await isTeamMember(t.db, team.id, ann.id)).toBe(false)
    expect(await isTeamMember(t.db, second.id, ann.id)).toBe(false)
    expect(await isTeamMember(t.db, other.team.id, ann.id)).toBe(true)
    const reviewers = await t.db
      .select()
      .from(schema.reviewRuleReviewers)
      .where(eq(schema.reviewRuleReviewers.ruleId, rule.id))
    expect(reviewers).toEqual([])
  })
})

describe('team members as read models', () => {
  it('lists by name with the workspace role, and leaves out people who left the workspace', async () => {
    const { team, owner, admin, ann } = await setup()
    await addTeamMembers(t.db, { teamId: team.id, userIds: [ann.id, admin.id], addedBy: owner.id })
    const list = await listTeamMembers(t.db, team.id)
    expect(list.map((m) => m.name)).toEqual(list.map((m) => m.name).toSorted())
    expect(list.find((m) => m.id === admin.id)?.role).toBe('admin')
    expect(list.find((m) => m.id === ann.id)?.role).toBe('member')
    await t.db.delete(schema.member).where(eq(schema.member.userId, ann.id))
    expect((await listTeamMembers(t.db, team.id)).map((m) => m.id)).not.toContain(ann.id)
  })

  it('summarises count, a preview of up to five and whether the person belongs', async () => {
    const { team, workspace, owner, ann } = await setup()
    const crowd = await Promise.all(Array.from({ length: 6 }, () => seedUser(t.db)))
    for (const u of crowd) {
      // oxlint-disable-next-line no-await-in-loop -- sequential seeding keeps ids stable
      await addTestMember(t.db, { workspaceId: workspace.id, userId: u.id, teams: [team.id] })
    }
    const summary = (await getTeamMemberSummaries(t.db, [team.id], ann.id)).get(team.id)
    expect(summary?.memberCount).toBe(7)
    expect(summary?.memberPreview).toHaveLength(5)
    expect(summary?.youAreMember).toBe(false)
    const mine = (await getTeamMemberSummaries(t.db, [team.id], owner.id)).get(team.id)
    expect(mine?.youAreMember).toBe(true)
  })

  it('shows each person the teams the viewer may see', async () => {
    const { team, workspace, owner, admin, ann, bob } = await setup()
    const secret = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'secret' })
    await addTestTeamMember(t.db, { teamId: team.id, userId: ann.id })
    await addTestTeamMember(t.db, { teamId: secret.id, userId: bob.id })
    await addTestTeamMember(t.db, { teamId: secret.id, userId: ann.id })

    const asAdmin = await listWorkspaceMemberTeams(t.db, {
      workspaceId: workspace.id,
      viewerId: admin.id,
    })
    expect(asAdmin[ann.id]?.map((x) => x.slug).toSorted()).toEqual(['secret', 'web'])
    expect(asAdmin[bob.id]?.map((x) => x.slug)).toEqual(['secret'])
    expect(asAdmin[owner.id]?.map((x) => x.slug)).toEqual(['web'])

    // Ann belongs to both, so she sees both; Bob only his own.
    const asBob = await listWorkspaceMemberTeams(t.db, {
      workspaceId: workspace.id,
      viewerId: bob.id,
    })
    expect(Object.keys(asBob).toSorted()).toEqual([ann.id, bob.id].toSorted())
    expect(asBob[ann.id]?.map((x) => x.slug)).toEqual(['secret'])
    expect(asBob[owner.id]).toBeUndefined()
  })
})

describe('findTeamForMember', () => {
  it('shows a team to its members and to owners and admins, never to other members', async () => {
    const { team, workspace, owner, admin, ann, bob } = await setup()
    await addTestTeamMember(t.db, { teamId: team.id, userId: ann.id })
    const ask = (userId: string) =>
      findTeamForMember(t.db, { workspaceSlug: workspace.slug, teamSlug: team.slug, userId })
    expect(await ask(owner.id)).toMatchObject({ id: team.id })
    expect(await ask(admin.id)).toMatchObject({ id: team.id })
    expect(await ask(ann.id)).toMatchObject({ id: team.id })
    expect(await ask(bob.id)).toBeUndefined()
  })
})

describe('acting from the code host', () => {
  it('lets only people who may see the team act, though any workspace member can be an author', async () => {
    const { team, owner, admin, ann, bob } = await setup()
    await addTestTeamMember(t.db, { teamId: team.id, userId: ann.id })
    for (const [user, accountId] of [
      [admin, 'gh-admin'],
      [ann, 'gh-ann'],
      [bob, 'gh-bob'],
      [owner, 'gh-owner'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- sequential seeding keeps ids stable
      await seedAccount(t.db, { userId: user.id, accountId })
    }
    const viewers = (accountId: string) =>
      findTeamViewersByAccount(t.db, team.id, 'github', accountId)
    expect(await viewers('gh-ann')).toEqual([ann.id])
    expect(await viewers('gh-admin')).toEqual([admin.id])
    expect(await viewers('gh-owner')).toEqual([owner.id])
    expect(await viewers('gh-bob')).toEqual([])
    expect(await findMembersByAccount(t.db, team.id, 'github', 'gh-bob')).toEqual([bob.id])
  })
})
