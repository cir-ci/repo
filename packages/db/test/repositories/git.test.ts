import { createTestDb, seedBuild, seedOrg, seedProject, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  claimDelivery,
  findBuildByCheckRun,
  findMemberByGithubId,
  findProjectsByRepo,
  getCheckRunId,
  getGitTarget,
  getPrCommentId,
  getProjectLink,
  latestBuildsForPr,
  linkProjectToGithub,
  NotFoundError,
  schema,
  setCheckRunId,
  setPrCommentId,
  unlinkProject,
} from '../../src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('project links', () => {
  it('links a project to a repository, reuses the installation, and unlinks', async () => {
    const { project, org, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { org: { org, owner }, slug: 'backend' })
    expect(await getProjectLink(t.db, project.id)).toBeUndefined()

    await linkProjectToGithub(t.db, project.id, { installationId: '42', repoRef: 'Acme/Web' })
    await linkProjectToGithub(t.db, second.project.id, {
      installationId: '42',
      repoRef: 'acme/api',
    })
    expect(await getProjectLink(t.db, project.id)).toEqual({
      installationId: '42',
      repoRef: 'Acme/Web',
    })
    const connections = await t.db.select().from(schema.providerConnections)
    expect(connections.filter((c) => c.orgId === org.id)).toHaveLength(1)

    await unlinkProject(t.db, project.id)
    expect(await getProjectLink(t.db, project.id)).toBeUndefined()
  })

  it('refuses to link a project that does not exist', async () => {
    await expect(
      linkProjectToGithub(t.db, '00000000-0000-0000-0000-000000000000', {
        installationId: '1',
        repoRef: 'a/b',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('finds projects by repository, ignoring case, per installation', async () => {
    const { project } = await seedProject(t.db)
    await linkProjectToGithub(t.db, project.id, { installationId: '77', repoRef: 'Acme/Shop' })
    expect(await findProjectsByRepo(t.db, '77', 'acme/SHOP')).toEqual([
      { id: project.id, orgId: project.orgId },
    ])
    expect(await findProjectsByRepo(t.db, '78', 'acme/shop')).toEqual([])
  })

  it('describes what the notify job needs for a linked build, and nothing for an unlinked one', async () => {
    const { project, org } = await seedProject(t.db)
    const build = await seedBuild(t.db, project.id)
    expect(await getGitTarget(t.db, build.id)).toBeUndefined()
    await linkProjectToGithub(t.db, project.id, { installationId: '9', repoRef: 'a/b' })
    const target = await getGitTarget(t.db, build.id)
    expect(target).toMatchObject({
      installationId: '9',
      repoRef: 'a/b',
      orgSlug: org.slug,
      projectSlug: project.slug,
      blockMergeOnChanges: project.blockMergeOnChanges,
    })
    expect(target?.build.id).toBe(build.id)
  })
})

describe('bookkeeping', () => {
  it('keeps one check run per build and one comment per pull request, replacing on repeat', async () => {
    const { project } = await seedProject(t.db)
    const build = await seedBuild(t.db, project.id)
    expect(await getCheckRunId(t.db, build.id)).toBeUndefined()
    await setCheckRunId(t.db, build.id, 'c1')
    await setCheckRunId(t.db, build.id, 'c2')
    expect(await getCheckRunId(t.db, build.id)).toBe('c2')
    expect((await findBuildByCheckRun(t.db, 'c2'))?.id).toBe(build.id)
    expect(await findBuildByCheckRun(t.db, 'c1')).toBeUndefined()

    expect(await getPrCommentId(t.db, project.id, 5)).toBeUndefined()
    await setPrCommentId(t.db, project.id, 5, 'k1')
    await setPrCommentId(t.db, project.id, 5, 'k2')
    expect(await getPrCommentId(t.db, project.id, 5)).toBe('k2')
    expect(await getPrCommentId(t.db, project.id, 6)).toBeUndefined()
  })

  it('claims a delivery once', async () => {
    expect(await claimDelivery(t.db, 'delivery-1')).toBe(true)
    expect(await claimDelivery(t.db, 'delivery-1')).toBe(false)
    expect(await claimDelivery(t.db, 'delivery-2')).toBe(true)
  })
})

describe('latestBuildsForPr', () => {
  it('returns only the builds of the newest commit, newest first', async () => {
    const { project } = await seedProject(t.db)
    await seedBuild(t.db, project.id, { commitSha: 'a1a1a1a', prNumber: 3, name: 'x' })
    const second = await seedBuild(t.db, project.id, {
      commitSha: 'b2b2b2b',
      prNumber: 3,
      name: 'x',
    })
    const third = await seedBuild(t.db, project.id, {
      commitSha: 'b2b2b2b',
      prNumber: 3,
      name: 'y',
    })
    await seedBuild(t.db, project.id, { commitSha: 'c3c3c3c', prNumber: 4 })
    expect((await latestBuildsForPr(t.db, project.id, 3)).map((b) => b.id)).toEqual([
      third.id,
      second.id,
    ])
    expect(await latestBuildsForPr(t.db, project.id, 99)).toEqual([])
  })
})

describe('findMemberByGithubId', () => {
  it('matches the linked GitHub account of someone in the project’s organization', async () => {
    const { project, owner } = await seedProject(t.db)
    const outside = (await seedOrg(t.db)).owner
    for (const [user, githubId] of [
      [owner, '1001'],
      [outside, '1002'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- two rows
      await t.db.insert(schema.account).values({
        id: `gh-${githubId}`,
        accountId: githubId,
        providerId: 'github',
        userId: user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    expect(await findMemberByGithubId(t.db, '1001', project.id)).toBe(owner.id)
    expect(await findMemberByGithubId(t.db, '1002', project.id)).toBeUndefined() // other org
    expect(await findMemberByGithubId(t.db, '9999', project.id)).toBeUndefined()
  })
})
