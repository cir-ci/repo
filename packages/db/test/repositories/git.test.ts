import { createTestDb, seedBuild, seedGitLink, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getProjectGitAttention, getProjectLink } from '#src/queries/index.ts'
import {
  claimDelivery,
  findBuildByCheckRun,
  findGitProjects,
  getCheckRunId,
  getGitTarget,
  getPrCommentId,
  clearInstallationNeedsAttention,
  markInstallationNeedsAttention,
  latestBuildsForPr,
  setCheckRunId,
  setPrCommentId,
  unlinkProject,
} from '#src/queue/index.ts'
import * as schema from '#src/schema/index.ts'

const GIT = ['github']

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('project links', () => {
  it('links a project to a repository, reuses the installation, and unlinks', async () => {
    const { project, workspace, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'backend' })
    expect(await getProjectLink(t.db, project.id, GIT)).toBeUndefined()

    await seedGitLink(t.db, project.id, { externalId: '42', repoRef: 'Acme/Web' })
    await seedGitLink(t.db, second.project.id, { externalId: '42', repoRef: 'acme/api' })
    expect(await getProjectLink(t.db, project.id, GIT)).toEqual({
      installationId: '42',
      repoRef: 'Acme/Web',
    })
    const connections = await t.db.select().from(schema.integrations)
    expect(connections.filter((c) => c.workspaceId === workspace.id)).toHaveLength(1)

    await unlinkProject(t.db, project.id, GIT)
    expect(await getProjectLink(t.db, project.id, GIT)).toBeUndefined()
  })

  it('records and clears that an installation needs attention, for every project on it', async () => {
    const a = await seedProject(t.db)
    const b = await seedProject(t.db)
    const other = await seedProject(t.db)
    await seedGitLink(t.db, a.project.id, { externalId: '555', repoRef: 'a/one' })
    await seedGitLink(t.db, b.project.id, { externalId: '555', repoRef: 'b/two' })
    await seedGitLink(t.db, other.project.id, { externalId: '556', repoRef: 'c/three' })
    expect(await getProjectGitAttention(t.db, a.project.id, GIT)).toBeUndefined()

    const first = new Date('2026-01-01T00:00:00Z')
    await markInstallationNeedsAttention(t.db, 'github', '555', 'installation_revoked', first)
    // Marking again keeps the time of the first failure.
    await markInstallationNeedsAttention(t.db, 'github', '555', 'installation_revoked', new Date())
    expect(await getProjectGitAttention(t.db, a.project.id, GIT)).toEqual({
      reason: 'installation_revoked',
      since: first,
    })
    expect(await getProjectGitAttention(t.db, b.project.id, GIT)).toBeDefined()
    expect(await getProjectGitAttention(t.db, other.project.id, GIT)).toBeUndefined()
    const build = await seedBuild(t.db, a.project.id)
    expect((await getGitTarget(t.db, build.id, GIT))?.connectionNeedsAttention).toBe(true)

    await clearInstallationNeedsAttention(t.db, 'github', '555')
    expect(await getProjectGitAttention(t.db, a.project.id, GIT)).toBeUndefined()
    expect((await getGitTarget(t.db, build.id, GIT))?.connectionNeedsAttention).toBe(false)
  })

  it('finds projects by repository, ignoring case, per connection', async () => {
    const { project } = await seedProject(t.db)
    await seedGitLink(t.db, project.id, { externalId: '77', repoRef: 'Acme/Shop' })
    expect(await findGitProjects(t.db, 'github', { externalId: '77' }, 'acme/SHOP')).toEqual([
      expect.objectContaining({
        id: project.id,
        workspaceId: project.workspaceId,
        externalId: '77',
      }),
    ])
    expect(await findGitProjects(t.db, 'github', { externalId: '78' }, 'acme/shop')).toEqual([])
    // A host named by the start of the id (GitLab's `host#`), and never across kinds.
    await seedGitLink(t.db, project.id, {
      kind: 'gitlab',
      externalId: 'git.acme.test#5',
      repoRef: 'g/h',
    })
    expect(
      (await findGitProjects(t.db, 'gitlab', { externalIdPrefix: 'GIT.acme.test#' }, 'G/H')).length,
    ).toBe(1)
    expect(await findGitProjects(t.db, 'github', { externalIdPrefix: 'git.' }, 'g/h')).toEqual([])
  })

  it('describes what the notify job needs for a linked build, and nothing for an unlinked one', async () => {
    const { project, workspace } = await seedProject(t.db)
    const build = await seedBuild(t.db, project.id)
    expect(await getGitTarget(t.db, build.id, GIT)).toBeUndefined()
    await seedGitLink(t.db, project.id, { externalId: '9', repoRef: 'a/b' })
    const target = await getGitTarget(t.db, build.id, GIT)
    expect(target).toMatchObject({
      installationId: '9',
      repoRef: 'a/b',
      workspaceSlug: workspace.slug,
      projectslug: project.slug,
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
