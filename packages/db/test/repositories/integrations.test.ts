import {
  createTestDb,
  seedBuild,
  seedGitConnection,
  seedGitLink,
  seedProject,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { integrationLinks } from '#schema/integration-links.ts'
import { ConflictError } from '#src/errors.ts'
import {
  getIntegration,
  getProjectLink,
  listBuildLinks,
  listIntegrations,
  listWorkspaceIntegrations,
  listWorkspaceProjectMappings,
  listProjectIntegrations,
  listProjectLinks,
} from '#src/queries/index.ts'
import { markInstallationNeedsAttention } from '#src/queue/index.ts'
import {
  createIntegration,
  createIntegrationLink,
  deleteAutoLinks,
  deleteIntegration,
  deleteIntegrationLink,
  findIntegrationByExternalId,
  getProjectIntegration,
  isAccountClaimedElsewhere,
  removeOtherProjectMappings,
  insertIntegrationLinksIfAbsent,
  listIntegrationProjects,
  removeIntegrationProject,
  replaceIntegrationCredentials,
  setIntegrationAttention,
  setIntegrationProject,
} from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('integrations', () => {
  it('adds, lists with project counts, maps projects once each, and removes with its mappings', async () => {
    const { workspace, project, owner } = await seedProject(t.db)
    const other = await seedProject(t.db)
    const slack = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'slack',
      displayName: 'Acme workspace',
      externalId: 'T1',
      encryptedCredentials: 'sealed',
      createdBy: owner.id,
    })
    await expect(
      createIntegration(t.db, {
        workspaceId: workspace.id,
        kind: 'slack',
        displayName: 'Again',
        externalId: 'T1',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    // The same account may be connected by another workspace.
    await createIntegration(t.db, {
      workspaceId: other.workspace.id,
      kind: 'slack',
      displayName: 'Theirs',
      externalId: 'T1',
    })

    await setIntegrationProject(t.db, {
      integrationId: slack.id,
      projectId: project.id,
      externalRef: '#ci',
    })
    await setIntegrationProject(t.db, {
      integrationId: slack.id,
      projectId: project.id,
      externalRef: '#visual',
      extra: { mentions: true },
    })
    expect(await listIntegrationProjects(t.db, slack.id)).toEqual([
      expect.objectContaining({
        slug: project.slug,
        externalRef: '#visual',
        extra: { mentions: true },
      }),
    ])
    expect(await listIntegrations(t.db, workspace.id)).toEqual([
      expect.objectContaining({ id: slack.id, displayName: 'Acme workspace', projectCount: 1 }),
    ])

    await setIntegrationAttention(t.db, slack.id, 'token_revoked')
    expect(await getIntegration(t.db, workspace.id, slack.id)).toMatchObject({
      needsAttention: true,
      needsAttentionReason: 'token_revoked',
    })
    expect(await getIntegration(t.db, other.workspace.id, slack.id)).toBeUndefined()

    await removeIntegrationProject(t.db, slack.id, project.id)
    expect(await listIntegrationProjects(t.db, slack.id)).toEqual([])
    await setIntegrationProject(t.db, {
      integrationId: slack.id,
      projectId: project.id,
      externalRef: '#x',
    })

    expect(await deleteIntegration(t.db, other.workspace.id, slack.id)).toBe(false)
    expect(await deleteIntegration(t.db, workspace.id, slack.id)).toBe(true)
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('stores any kind: the registry validates kinds, not the table', async () => {
    const { workspace } = await seedProject(t.db)
    const row = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'teams',
      displayName: 'x',
      externalId: 'x',
    })
    expect(row.kind).toBe('teams')
  })

  it('finds an integration by its external account and replaces its credentials', async () => {
    const { workspace } = await seedProject(t.db)
    const made = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'slack',
      displayName: 'Old',
      externalId: 'T-find',
      encryptedCredentials: 'a',
    })
    expect(await findIntegrationByExternalId(t.db, workspace.id, 'slack', 'T-find')).toEqual({
      id: made.id,
    })
    expect(await findIntegrationByExternalId(t.db, workspace.id, 'jira', 'T-find')).toBeUndefined()
    await setIntegrationAttention(t.db, made.id, 'revoked')
    await replaceIntegrationCredentials(t.db, made.id, {
      displayName: 'New',
      encryptedCredentials: 'b',
    })
    expect(await getIntegration(t.db, workspace.id, made.id)).toMatchObject({
      displayName: 'New',
      encryptedCredentials: 'b',
      needsAttention: false,
    })
  })

  it('lists every project of the workspace with its mapping on one integration', async () => {
    const { workspace, project, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'backend' })
    const made = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'slack',
      displayName: 'Acme',
      externalId: 'T-map',
    })
    await setIntegrationProject(t.db, {
      integrationId: made.id,
      projectId: second.project.id,
      externalRef: 'C1',
      extra: { name: 'web', events: ['build.rejected'] },
    })
    const rows = await listWorkspaceProjectMappings(t.db, workspace.id, made.id)
    expect(rows.map((r) => [r.slug, r.mapping?.externalRef ?? null])).toEqual([
      ['backend', 'C1'],
      [project.slug, null],
    ])
    expect(rows[0]?.mapping?.extra).toEqual({ name: 'web', events: ['build.rejected'] })
  })
})

describe('integration links', () => {
  it('keeps one project-wide link per kind and subject, and any number per build', async () => {
    const { workspace, project } = await seedProject(t.db)
    const made = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'figma',
      displayName: 'Figma',
      externalId: 'F1',
    })
    const first = await createIntegrationLink(t.db, {
      integrationId: made.id,
      projectId: project.id,
      kind: 'figma-frame',
      subject: 'checkout/*',
      externalRef: 'file:1',
      payload: { source: 'manual' },
    })
    const again = await createIntegrationLink(t.db, {
      integrationId: made.id,
      projectId: project.id,
      kind: 'figma-frame',
      subject: 'checkout/*',
      externalRef: 'file:2',
    })
    expect(again.id).toBe(first.id)
    expect(again.externalRef).toBe('file:2')
    expect(await listProjectLinks(t.db, project.id, 'figma-frame')).toHaveLength(1)
    expect(await deleteIntegrationLink(t.db, made.id, first.id)).toBe(true)
    expect(await deleteIntegrationLink(t.db, made.id, first.id)).toBe(false)
    expect(await listProjectLinks(t.db, project.id, 'figma-frame')).toEqual([])
  })
})

async function seedFigma() {
  const { workspace, project } = await seedProject(t.db)
  const made = await createIntegration(t.db, {
    workspaceId: workspace.id,
    kind: 'figma',
    displayName: 'Figma',
    externalId: `F-${workspace.id}`,
  })
  return { workspace, project, made }
}

describe('integration link helpers', () => {
  it('adds automatic links without replacing a subject the project has, and drops them by scope', async () => {
    const { project, made } = await seedFigma()
    const link = (subject: string, scope: string, source: 'auto' | 'manual') => ({
      integrationId: made.id,
      projectId: project.id,
      kind: 'figma-frame',
      subject,
      externalRef: `${scope}:1`,
      payload: { source, scope },
    })
    await createIntegrationLink(t.db, link('cart', 'FileA', 'manual'))
    expect(
      await insertIntegrationLinksIfAbsent(t.db, [
        link('cart', 'FileA', 'auto'),
        link('pay', 'FileA', 'auto'),
        link('home', 'FileB', 'auto'),
      ]),
    ).toBe(2)
    expect(await insertIntegrationLinksIfAbsent(t.db, [])).toBe(0)
    const subjects = async () =>
      (await listProjectLinks(t.db, project.id, 'figma-frame')).map((l) => l.subject)
    expect(await subjects()).toEqual(['cart', 'home', 'pay'])
    // Keeping FileA drops FileB's automatic link only; the manual one stays whatever its file.
    await deleteAutoLinks(t.db, { projectId: project.id, kind: 'figma-frame', keepScope: 'FileA' })
    expect(await subjects()).toEqual(['cart', 'pay'])
    await deleteAutoLinks(t.db, { projectId: project.id, kind: 'figma-frame' })
    expect(await subjects()).toEqual(['cart'])
  })

  it('deletes a link of a project only through that project', async () => {
    const a = await seedFigma()
    const b = await seedFigma()
    const link = await createIntegrationLink(t.db, {
      integrationId: a.made.id,
      projectId: a.project.id,
      kind: 'figma-frame',
      subject: 'x',
      externalRef: 'k:1',
    })
    expect(await deleteIntegrationLink(t.db, a.made.id, link.id, b.project.id)).toBe(false)
    expect(await deleteIntegrationLink(t.db, a.made.id, link.id, a.project.id)).toBe(true)
  })

  it("lists a build's links oldest first with their integration and author", async () => {
    const { project, made } = await seedFigma()
    const build = await seedBuild(t.db, project.id)
    const created: { id: string }[] = []
    for (const key of ['WEB-1', 'WEB-2']) {
      // oxlint-disable-next-line no-await-in-loop -- order matters
      const link = await createIntegrationLink(t.db, {
        integrationId: made.id,
        buildId: build.id,
        kind: 'issue',
        externalRef: key,
        payload: { snapshotName: null },
      })
      created.push(link)
    }
    // Inserts in quick succession can share a timestamp: spell the order out.
    const [first, second] = created
    await t.db
      .update(integrationLinks)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(integrationLinks.id, first?.id ?? ''))
    await t.db
      .update(integrationLinks)
      .set({ createdAt: new Date('2026-01-02T00:00:00Z') })
      .where(eq(integrationLinks.id, second?.id ?? ''))
    await createIntegrationLink(t.db, {
      integrationId: made.id,
      buildId: build.id,
      kind: 'other',
      externalRef: 'x',
    })
    const issues = await listBuildLinks(t.db, build.id, 'issue')
    expect(issues.map((l) => [l.externalRef, l.integrationKind, l.createdByName])).toEqual([
      ['WEB-1', 'figma', null],
      ['WEB-2', 'figma', null],
    ])
    expect(await listBuildLinks(t.db, build.id)).toHaveLength(3)
  })

  it('lists the integrations of given kinds a project is mapped to, and one with its mapping', async () => {
    const { workspace, project, made } = await seedFigma()
    const linear = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'linear',
      displayName: 'Acme',
      externalId: 'L1',
    })
    await setIntegrationProject(t.db, {
      integrationId: made.id,
      projectId: project.id,
      externalRef: 'FileKey',
      extra: { name: 'Checkout' },
    })
    await setIntegrationProject(t.db, {
      integrationId: linear.id,
      projectId: project.id,
      externalRef: 'project-1',
      extra: { name: 'Web' },
    })
    const mapped = await listProjectIntegrations(t.db, project.id, ['linear', 'jira'])
    expect(mapped.map((m) => [m.kind, m.externalRef, m.extra.name])).toEqual([
      ['linear', 'project-1', 'Web'],
    ])
    expect(await listProjectIntegrations(t.db, project.id, [])).toEqual([])
    expect((await getProjectIntegration(t.db, project.id, made.id))?.externalRef).toBe('FileKey')
    const other = await seedProject(t.db)
    expect(await getProjectIntegration(t.db, other.project.id, made.id)).toBeUndefined()
  })
})

describe('git hosts as integrations', () => {
  it('counts projects, shows needs-attention with its time, and removing it stops every project', async () => {
    const { workspace, project, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'backend' })
    const { id } = await seedGitConnection(t.db, { workspaceId: workspace.id, externalId: '501' })
    expect(
      (await seedGitConnection(t.db, { workspaceId: workspace.id, externalId: '501' })).id,
    ).toBe(id)
    expect((await listIntegrations(t.db, workspace.id))[0]).toMatchObject({
      id,
      kind: 'github',
      displayName: 'Installation 501',
      projectCount: 0,
    })

    await seedGitLink(t.db, project.id, { externalId: '501', repoRef: 'acme/web' })
    await seedGitLink(t.db, second.project.id, { externalId: '501', repoRef: 'acme/api' })
    expect((await listIntegrations(t.db, workspace.id))[0]?.projectCount).toBe(2)

    await markInstallationNeedsAttention(t.db, 'github', '501', 'The App was removed')
    expect(
      await listWorkspaceIntegrations(t.db, workspace.id, () => ({
        group: 'git',
        name: 'GitHub',
      })),
    ).toEqual([
      expect.objectContaining({
        id,
        kind: 'github',
        group: 'git',
        needsAttention: true,
        attentionReason: 'The App was removed',
        projectCount: 2,
      }),
    ])

    const stranger = await seedProject(t.db)
    expect(await deleteIntegration(t.db, stranger.workspace.id, id)).toBe(false)
    expect(await getIntegration(t.db, workspace.id, id)).toBeDefined()
    expect(await deleteIntegration(t.db, workspace.id, id)).toBe(true)
    expect(await getProjectLink(t.db, project.id, ['github'])).toBeUndefined()
    expect(await getProjectLink(t.db, second.project.id, ['github'])).toBeUndefined()
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('tells whether another workspace has the account, and sets the time of attention once', async () => {
    const a = await seedProject(t.db)
    const b = await seedProject(t.db)
    const { id } = await seedGitConnection(t.db, {
      workspaceId: a.workspace.id,
      externalId: '8000',
    })
    expect(await isAccountClaimedElsewhere(t.db, 'github', '8000', a.workspace.id)).toBe(false)
    expect(await isAccountClaimedElsewhere(t.db, 'github', '8000', b.workspace.id)).toBe(true)
    expect(await isAccountClaimedElsewhere(t.db, 'gitlab', '8000', b.workspace.id)).toBe(false)

    await setIntegrationAttention(t.db, id, 'gone')
    const first = (await getIntegration(t.db, a.workspace.id, id))?.needsAttentionAt
    expect(first).toBeInstanceOf(Date)
    await setIntegrationAttention(t.db, id, 'gone again')
    expect((await getIntegration(t.db, a.workspace.id, id))?.needsAttentionAt).toEqual(first)
    await setIntegrationAttention(t.db, id, null)
    expect((await getIntegration(t.db, a.workspace.id, id))?.needsAttentionAt).toBeNull()
  })

  it("drops a project's mappings on other integrations of the kinds, keeping the one named", async () => {
    const { workspace, project } = await seedProject(t.db)
    const one = await seedGitLink(t.db, project.id, { externalId: '1', repoRef: 'a/b' })
    const two = await seedGitLink(t.db, project.id, {
      exclusive: false,
      kind: 'gitlab',
      externalId: 'h#1',
      repoRef: 'a/b',
    })
    const slack = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'slack',
      displayName: 'Chat',
      externalId: 's',
    })
    await setIntegrationProject(t.db, {
      integrationId: slack.id,
      projectId: project.id,
      externalRef: 'C1',
    })
    const removed = await removeOtherProjectMappings(t.db, {
      projectId: project.id,
      keepIntegrationId: two.integrationId,
      kinds: ['github', 'gitlab'],
    })
    expect(removed).toEqual([one.integrationId])
    // Same-instant inserts have no defined order: compare the set.
    expect(
      (await listProjectIntegrations(t.db, project.id, ['github', 'gitlab', 'slack']))
        .map((m) => m.kind)
        .toSorted(),
    ).toEqual(['gitlab', 'slack'])
  })
})
