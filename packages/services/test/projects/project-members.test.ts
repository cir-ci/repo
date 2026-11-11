import { ForbiddenError, NotFoundError, ValidationError } from '@circi/core'
import {
  getTriageRotation,
  isProjectMember,
  listReviewRules,
  listProjectMembers,
} from '@circi/db/queries'
import {
  addTestMember,
  addTestProjectMember,
  createTestDb,
  seedBuild,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  type Actor,
  addMembersToProject,
  addReviewRule,
  editReviewRule,
  removeMemberFromProject,
  removeMemberFromWorkspaceProjects,
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

const actor = (userId: string, role: string, projectMember: boolean): Actor => ({
  userId,
  instanceAdmin: false,
  role,
  projectMember,
})

/** An owner, an admin outside the project, a member of the project and a member who is not in it. */
async function setup() {
  const { project, workspace, owner } = await seedProject(t.db)
  const admin = await seedUser(t.db)
  const ann = await seedUser(t.db)
  const bob = await seedUser(t.db)
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: admin.id,
    role: 'admin',
    projects: [],
  })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id, projects: [project.id] })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: bob.id, projects: [] })
  return {
    project,
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

describe('addMembersToProject', () => {
  it('lets owners and admins add anyone, themselves included, and ignores someone already in', async () => {
    const { project, admin, ann, bob, asOwner, asAdmin } = await setup()
    expect(
      await addMembersToProject(t.db, {
        actor: asOwner,
        projectId: project.id,
        userIds: [bob.id, ann.id],
      }),
    ).toEqual([bob.id])
    expect(
      await addMembersToProject(t.db, {
        actor: asAdmin,
        projectId: project.id,
        userIds: [admin.id],
      }),
    ).toEqual([admin.id])
    expect(await isProjectMember(t.db, project.id, admin.id)).toBe(true)
  })

  it('refuses a member (403), and answers a member who cannot see the project as for a missing one (404)', async () => {
    const { project, bob, asAnn, asBob } = await setup()
    await expect(
      addMembersToProject(t.db, { actor: asAnn, projectId: project.id, userIds: [bob.id] }),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      addMembersToProject(t.db, { actor: asBob, projectId: project.id, userIds: [bob.id] }),
    ).rejects.toThrow(NotFoundError)
    expect(await isProjectMember(t.db, project.id, bob.id)).toBe(false)
  })

  it('refuses people who are not in the workspace, adding nobody', async () => {
    const { project, bob, asOwner } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      addMembersToProject(t.db, {
        actor: asOwner,
        projectId: project.id,
        userIds: [bob.id, stranger.id],
      }),
    ).rejects.toThrow(ValidationError)
    expect(await isProjectMember(t.db, project.id, bob.id)).toBe(false)
  })
})

describe('removeMemberFromProject', () => {
  it('lets owners and admins remove anyone, and a member remove only themselves', async () => {
    const { project, owner, ann, asAdmin, asAnn } = await setup()
    await expect(
      removeMemberFromProject(t.db, { actor: asAnn, projectId: project.id, userId: owner.id }),
    ).rejects.toThrow(ForbiddenError)
    expect(
      await removeMemberFromProject(t.db, {
        actor: asAdmin,
        projectId: project.id,
        userId: owner.id,
      }),
    ).toBe(true)
    expect(
      await removeMemberFromProject(t.db, { actor: asAnn, projectId: project.id, userId: ann.id }),
    ).toBe(true)
    // The last members are gone; an empty project is allowed, and removing again does nothing.
    expect(await listProjectMembers(t.db, project.id)).toEqual([])
    expect(
      await removeMemberFromProject(t.db, {
        actor: asAdmin,
        projectId: project.id,
        userId: ann.id,
      }),
    ).toBe(false)
  })

  it('does not let a member of no part of the project remove anyone: 404', async () => {
    const { project, ann, asBob } = await setup()
    await expect(
      removeMemberFromProject(t.db, { actor: asBob, projectId: project.id, userId: ann.id }),
    ).rejects.toThrow(NotFoundError)
  })

  it('takes the person off the rules and the rotation in the same change, keeping past requests', async () => {
    const { project, owner, ann, asAnn } = await setup()
    await addReviewRule(t.db, {
      projectId: project.id,
      kind: 'snapshot-name',
      pattern: 'a/**',
      reviewerIds: [ann.id, owner.id],
    })
    await replaceTriageRotation(t.db, { projectId: project.id, memberIds: [owner.id, ann.id] })
    await assignTriage(t.db, {
      projectId: project.id,
      kind: 'flaky',
      key: 'home',
      assigneeId: ann.id,
    })
    const build = await seedBuild(t.db, project.id, { branch: 'feature' })
    await requestReview(t.db, { buildId: build.id, reviewerId: ann.id, requestedById: owner.id })

    await removeMemberFromProject(t.db, { actor: asAnn, projectId: project.id, userId: ann.id })

    expect((await listReviewRules(t.db, project.id))[0]?.reviewers.map((r) => r.id)).toEqual([
      owner.id,
    ])
    expect((await getTriageRotation(t.db, project.id)).members.map((m) => m.id)).toEqual([owner.id])
    const requests = await t.db.query.reviewRequests.findMany()
    expect(requests.filter((r) => r.reviewerId === ann.id)).toHaveLength(1)
  })
})

describe('removeMemberFromWorkspaceProjects', () => {
  it('takes the person out of every project of the workspace', async () => {
    const { project, workspace, owner, ann } = await setup()
    const second = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'docs' })
    await addTestProjectMember(t.db, { projectId: second.project.id, userId: ann.id })
    await removeMemberFromWorkspaceProjects(t.db, { workspaceId: workspace.id, userId: ann.id })
    expect(await isProjectMember(t.db, project.id, ann.id)).toBe(false)
    expect(await isProjectMember(t.db, second.project.id, ann.id)).toBe(false)
  })
})

describe('who can be picked', () => {
  it('accepts only project members as rule reviewers, rotation members, assignees and requested reviewers', async () => {
    const { project, owner, bob } = await setup()
    // Bob belongs to the workspace and not to the project.
    await expect(
      addReviewRule(t.db, {
        projectId: project.id,
        kind: 'snapshot-name',
        pattern: 'x',
        reviewerIds: [bob.id],
      }),
    ).rejects.toThrow(/members of this project/)
    const rule = await addReviewRule(t.db, {
      projectId: project.id,
      kind: 'snapshot-name',
      pattern: 'x',
      reviewerIds: [owner.id],
    })
    await expect(
      editReviewRule(t.db, {
        projectId: project.id,
        id: rule.id,
        kind: 'snapshot-name',
        pattern: 'x',
        reviewerIds: [bob.id],
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      replaceTriageRotation(t.db, { projectId: project.id, memberIds: [bob.id] }),
    ).rejects.toThrow(/member of this project/)
    await expect(
      assignTriage(t.db, { projectId: project.id, kind: 'flaky', key: 'home', assigneeId: bob.id }),
    ).rejects.toThrow(ValidationError)
    const build = await seedBuild(t.db, project.id, { branch: 'feature' })
    await expect(
      requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id }),
    ).rejects.toThrow(/must be a member of this project/)
  })
})
