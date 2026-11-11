import { ValidationError } from '@circi/core'
import {
  addTestMember,
  addTestProjectMember,
  createTestDb,
  seedAccount,
  seedBuild,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  findProjectForMember,
  getProjectMemberSummaries,
  isProjectMember,
  listProjectMembers,
  listWorkspaceMemberProjects,
} from '#src/queries/index.ts'
import {
  addProjectMembers,
  findMembersByAccount,
  findProjectViewersByAccount,
  createReviewRule,
  createProject,
  openReviewRequest,
  removeProjectMember,
  removeUserFromWorkspaceProjects,
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

/** A workspace with an owner, an admin, two plain members and a project nobody but the owner is in. */
async function setup() {
  const { project, workspace, owner } = await seedProject(t.db)
  const people = {
    admin: await seedUser(t.db),
    ann: await seedUser(t.db),
    bob: await seedUser(t.db),
  }
  // Added after the project, and with no project, as an invited person would be.
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: people.admin.id,
    role: 'admin',
    projects: [],
  })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: people.ann.id, projects: [] })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: people.bob.id, projects: [] })
  return { project, workspace, owner, ...people }
}

describe('addProjectMembers', () => {
  it('adds workspace members, once each, and says who was new', async () => {
    const { project, owner, ann, bob } = await setup()
    expect(
      await addProjectMembers(t.db, {
        projectId: project.id,
        userIds: [ann.id, ann.id],
        addedBy: owner.id,
      }),
    ).toEqual([ann.id])
    expect(
      (
        await addProjectMembers(t.db, {
          projectId: project.id,
          userIds: [ann.id, bob.id],
          addedBy: owner.id,
        })
      ).toSorted(),
    ).toEqual([bob.id])
    expect((await listProjectMembers(t.db, project.id)).map((m) => m.id).toSorted()).toEqual(
      [owner.id, ann.id, bob.id].toSorted(),
    )
    const [row] = await t.db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, bob.id))
    expect(row?.addedBy).toBe(owner.id)
  })

  it('refuses people outside the workspace, and adds nobody then', async () => {
    const { project, ann } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      addProjectMembers(t.db, {
        projectId: project.id,
        userIds: [ann.id, stranger.id],
        addedBy: null,
      }),
    ).rejects.toThrow(ValidationError)
    expect(await isProjectMember(t.db, project.id, ann.id)).toBe(false)
  })

  it('does nothing for an empty list', async () => {
    const { project } = await setup()
    expect(
      await addProjectMembers(t.db, { projectId: project.id, userIds: [], addedBy: null }),
    ).toEqual([])
  })
})

describe('createProject members', () => {
  it('adds the creator and the given workspace members', async () => {
    const { workspace, owner, ann, bob } = await setup()
    const project = await createProject(t.db, {
      workspaceSlug: workspace.slug,
      name: 'docs',
      createdBy: owner.id,
      memberIds: [ann.id, owner.id],
    })
    expect((await listProjectMembers(t.db, project.id)).map((m) => m.id).toSorted()).toEqual(
      [owner.id, ann.id].toSorted(),
    )
    expect(await isProjectMember(t.db, project.id, bob.id)).toBe(false)
  })

  it('starts empty when nobody is named, and refuses non-members without creating the project', async () => {
    const { workspace } = await setup()
    const empty = await createProject(t.db, { workspaceSlug: workspace.slug, name: 'empty' })
    expect(await listProjectMembers(t.db, empty.id)).toEqual([])
    const stranger = await seedUser(t.db)
    await expect(
      createProject(t.db, {
        workspaceSlug: workspace.slug,
        name: 'nope',
        memberIds: [stranger.id],
      }),
    ).rejects.toThrow(ValidationError)
    const slugs = await t.db
      .select({ slug: schema.projects.slug })
      .from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspace.id))
    expect(slugs.map((s) => s.slug)).not.toContain('nope')
  })
})

describe('removeProjectMember', () => {
  it('takes the person off the rules, the rotation and their assigned items, and keeps what happened', async () => {
    const { project, owner, ann } = await setup()
    await addProjectMembers(t.db, { projectId: project.id, userIds: [ann.id], addedBy: owner.id })
    const rule = await createReviewRule(t.db, {
      projectId: project.id,
      kind: 'snapshot-name',
      pattern: 'a/**',
      reviewerIds: [ann.id, owner.id],
    })
    await setTriageRotation(t.db, { projectId: project.id, memberIds: [ann.id, owner.id] })
    await assignTriageItem(t.db, {
      projectId: project.id,
      kind: 'flaky',
      key: 'home',
      assigneeId: ann.id,
    })
    const build = await seedBuild(t.db, project.id, { branch: 'feature' })
    await openReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: ann.id,
      requestedById: owner.id,
      dueAt: null,
    })

    expect(await removeProjectMember(t.db, { projectId: project.id, userId: ann.id })).toBe(true)

    expect(await isProjectMember(t.db, project.id, ann.id)).toBe(false)
    const reviewers = await t.db
      .select()
      .from(schema.reviewRuleReviewers)
      .where(eq(schema.reviewRuleReviewers.ruleId, rule.id))
    expect(reviewers.map((r) => r.userId)).toEqual([owner.id])
    const rotation = await t.db.select().from(schema.triageRotationMembers)
    expect(rotation.filter((r) => r.projectId === project.id).map((r) => r.userId)).toEqual([
      owner.id,
    ])
    const [item] = await t.db
      .select()
      .from(schema.triageItems)
      .where(eq(schema.triageItems.projectId, project.id))
    expect(item?.assigneeId).toBeNull()
    // The request stays, as does everything else in the past.
    const requests = await t.db
      .select()
      .from(schema.reviewRequests)
      .where(eq(schema.reviewRequests.reviewerId, ann.id))
    expect(requests).toHaveLength(1)
  })

  it('switches the rotation off when its last person goes', async () => {
    const { project, owner } = await setup()
    await setTriageRotation(t.db, { projectId: project.id, memberIds: [owner.id] })
    await removeProjectMember(t.db, { projectId: project.id, userId: owner.id })
    const [row] = await t.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
    expect(row?.triageRotationStartsOn).toBeNull()
  })

  it('allows removing the last member, and says false for someone who was not in', async () => {
    const { project, owner, bob } = await setup()
    expect(await removeProjectMember(t.db, { projectId: project.id, userId: bob.id })).toBe(false)
    expect(await removeProjectMember(t.db, { projectId: project.id, userId: owner.id })).toBe(true)
    expect(await listProjectMembers(t.db, project.id)).toEqual([])
  })
})

describe('removeUserFromWorkspaceProjects', () => {
  it('takes the person out of every project of the workspace, and only that workspace', async () => {
    const { project, workspace, owner, ann } = await setup()
    const second = await createProject(t.db, { workspaceSlug: workspace.slug, name: 'second' })
    await addProjectMembers(t.db, { projectId: project.id, userIds: [ann.id], addedBy: owner.id })
    await addProjectMembers(t.db, { projectId: second.id, userIds: [ann.id], addedBy: owner.id })
    const rule = await createReviewRule(t.db, {
      projectId: second.id,
      kind: 'snapshot-name',
      pattern: 'a/**',
      reviewerIds: [ann.id],
    })
    const other = await seedProject(t.db)
    await addTestMember(t.db, { workspaceId: other.workspace.id, userId: ann.id })

    await removeUserFromWorkspaceProjects(t.db, { workspaceId: workspace.id, userId: ann.id })

    expect(await isProjectMember(t.db, project.id, ann.id)).toBe(false)
    expect(await isProjectMember(t.db, second.id, ann.id)).toBe(false)
    expect(await isProjectMember(t.db, other.project.id, ann.id)).toBe(true)
    const reviewers = await t.db
      .select()
      .from(schema.reviewRuleReviewers)
      .where(eq(schema.reviewRuleReviewers.ruleId, rule.id))
    expect(reviewers).toEqual([])
  })
})

describe('project members as read models', () => {
  it('lists by name with the workspace role, and leaves out people who left the workspace', async () => {
    const { project, owner, admin, ann } = await setup()
    await addProjectMembers(t.db, {
      projectId: project.id,
      userIds: [ann.id, admin.id],
      addedBy: owner.id,
    })
    const list = await listProjectMembers(t.db, project.id)
    expect(list.map((m) => m.name)).toEqual(list.map((m) => m.name).toSorted())
    expect(list.find((m) => m.id === admin.id)?.role).toBe('admin')
    expect(list.find((m) => m.id === ann.id)?.role).toBe('member')
    await t.db.delete(schema.member).where(eq(schema.member.userId, ann.id))
    expect((await listProjectMembers(t.db, project.id)).map((m) => m.id)).not.toContain(ann.id)
  })

  it('summarises count, a preview of up to five and whether the person belongs', async () => {
    const { project, workspace, owner, ann } = await setup()
    const crowd = await Promise.all(Array.from({ length: 6 }, () => seedUser(t.db)))
    for (const u of crowd) {
      // oxlint-disable-next-line no-await-in-loop -- sequential seeding keeps ids stable
      await addTestMember(t.db, { workspaceId: workspace.id, userId: u.id, projects: [project.id] })
    }
    const summary = (await getProjectMemberSummaries(t.db, [project.id], ann.id)).get(project.id)
    expect(summary?.memberCount).toBe(7)
    expect(summary?.memberPreview).toHaveLength(5)
    expect(summary?.youAreMember).toBe(false)
    const mine = (await getProjectMemberSummaries(t.db, [project.id], owner.id)).get(project.id)
    expect(mine?.youAreMember).toBe(true)
  })

  it('shows each person the projects the viewer may see', async () => {
    const { project, workspace, owner, admin, ann, bob } = await setup()
    const secret = await createProject(t.db, { workspaceSlug: workspace.slug, name: 'secret' })
    await addTestProjectMember(t.db, { projectId: project.id, userId: ann.id })
    await addTestProjectMember(t.db, { projectId: secret.id, userId: bob.id })
    await addTestProjectMember(t.db, { projectId: secret.id, userId: ann.id })

    const asAdmin = await listWorkspaceMemberProjects(t.db, {
      workspaceId: workspace.id,
      viewerId: admin.id,
    })
    expect(asAdmin[ann.id]?.map((x) => x.slug).toSorted()).toEqual(['secret', 'web'])
    expect(asAdmin[bob.id]?.map((x) => x.slug)).toEqual(['secret'])
    expect(asAdmin[owner.id]?.map((x) => x.slug)).toEqual(['web'])

    // Ann belongs to both, so she sees both; Bob only his own.
    const asBob = await listWorkspaceMemberProjects(t.db, {
      workspaceId: workspace.id,
      viewerId: bob.id,
    })
    expect(Object.keys(asBob).toSorted()).toEqual([ann.id, bob.id].toSorted())
    expect(asBob[ann.id]?.map((x) => x.slug)).toEqual(['secret'])
    expect(asBob[owner.id]).toBeUndefined()
  })
})

describe('findProjectForMember', () => {
  it('shows a project to its members and to owners and admins, never to other members', async () => {
    const { project, workspace, owner, admin, ann, bob } = await setup()
    await addTestProjectMember(t.db, { projectId: project.id, userId: ann.id })
    const ask = (userId: string) =>
      findProjectForMember(t.db, {
        workspaceSlug: workspace.slug,
        projectslug: project.slug,
        userId,
      })
    expect(await ask(owner.id)).toMatchObject({ id: project.id })
    expect(await ask(admin.id)).toMatchObject({ id: project.id })
    expect(await ask(ann.id)).toMatchObject({ id: project.id })
    expect(await ask(bob.id)).toBeUndefined()
  })
})

describe('acting from the code host', () => {
  it('lets only people who may see the project act, though any workspace member can be an author', async () => {
    const { project, owner, admin, ann, bob } = await setup()
    await addTestProjectMember(t.db, { projectId: project.id, userId: ann.id })
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
      findProjectViewersByAccount(t.db, project.id, 'github', accountId)
    expect(await viewers('gh-ann')).toEqual([ann.id])
    expect(await viewers('gh-admin')).toEqual([admin.id])
    expect(await viewers('gh-owner')).toEqual([owner.id])
    expect(await viewers('gh-bob')).toEqual([])
    expect(await findMembersByAccount(t.db, project.id, 'github', 'gh-bob')).toEqual([bob.id])
  })
})
