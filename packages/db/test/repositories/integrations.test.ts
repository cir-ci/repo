import { createTestDb, seedBuild, seedProject } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConflictError } from '#src/errors.ts'
import {
  connectGithub,
  createIntegration,
  createIntegrationLink,
  deleteAutoLinks,
  deleteIntegration,
  deleteIntegrationLink,
  findIntegrationByExternalId,
  getGitConnection,
  getIntegration,
  getProjectIntegration,
  getProjectLink,
  insertIntegrationLinksIfAbsent,
  linkProjectToGithub,
  listBuildLinks,
  listGitConnections,
  listIntegrationProjects,
  listIntegrations,
  listOrgIntegrations,
  listOrgProjectMappings,
  listProjectIntegrations,
  listProjectLinks,
  listProjectRepoLinks,
  markInstallationNeedsAttention,
  removeGitConnection,
  removeIntegrationProject,
  replaceIntegrationCredentials,
  setIntegrationAttention,
  setIntegrationProject,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('integrations', () => {
  it('adds, lists with project counts, maps projects once each, and removes with its mappings', async () => {
    const { org, project, owner } = await seedProject(t.db)
    const other = await seedProject(t.db)
    const slack = await createIntegration(t.db, {
      orgId: org.id,
      kind: 'slack',
      displayName: 'Acme workspace',
      externalId: 'T1',
      encryptedCredentials: 'sealed',
      createdBy: owner.id,
    })
    await expect(
      createIntegration(t.db, {
        orgId: org.id,
        kind: 'slack',
        displayName: 'Again',
        externalId: 'T1',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    // The same account may be connected by another organisation.
    await createIntegration(t.db, {
      orgId: other.org.id,
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
    expect(await listIntegrations(t.db, org.id)).toEqual([
      expect.objectContaining({ id: slack.id, displayName: 'Acme workspace', projectCount: 1 }),
    ])

    await setIntegrationAttention(t.db, slack.id, 'token_revoked')
    expect(await getIntegration(t.db, org.id, slack.id)).toMatchObject({
      needsAttention: true,
      needsAttentionReason: 'token_revoked',
    })
    expect(await getIntegration(t.db, other.org.id, slack.id)).toBeUndefined()

    await removeIntegrationProject(t.db, slack.id, project.id)
    expect(await listIntegrationProjects(t.db, slack.id)).toEqual([])
    await setIntegrationProject(t.db, {
      integrationId: slack.id,
      projectId: project.id,
      externalRef: '#x',
    })

    expect(await deleteIntegration(t.db, other.org.id, slack.id)).toBe(false)
    expect(await deleteIntegration(t.db, org.id, slack.id)).toBe(true)
    expect(await listIntegrations(t.db, org.id)).toEqual([])
  })

  it('stores any kind: the registry validates kinds, not the table', async () => {
    const { org } = await seedProject(t.db)
    const row = await createIntegration(t.db, {
      orgId: org.id,
      kind: 'teams',
      displayName: 'x',
      externalId: 'x',
    })
    expect(row.kind).toBe('teams')
  })

  it('finds an integration by its external account and replaces its credentials', async () => {
    const { org } = await seedProject(t.db)
    const made = await createIntegration(t.db, {
      orgId: org.id,
      kind: 'slack',
      displayName: 'Old',
      externalId: 'T-find',
      encryptedCredentials: 'a',
    })
    expect(await findIntegrationByExternalId(t.db, org.id, 'slack', 'T-find')).toEqual({
      id: made.id,
    })
    expect(await findIntegrationByExternalId(t.db, org.id, 'jira', 'T-find')).toBeUndefined()
    await setIntegrationAttention(t.db, made.id, 'revoked')
    await replaceIntegrationCredentials(t.db, made.id, {
      displayName: 'New',
      encryptedCredentials: 'b',
    })
    expect(await getIntegration(t.db, org.id, made.id)).toMatchObject({
      displayName: 'New',
      encryptedCredentials: 'b',
      needsAttention: false,
    })
  })

  it('lists every project of the organisation with its mapping on one integration', async () => {
    const { org, project, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { org: { org, owner }, slug: 'backend' })
    const made = await createIntegration(t.db, {
      orgId: org.id,
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
    const rows = await listOrgProjectMappings(t.db, org.id, made.id)
    expect(rows.map((r) => [r.slug, r.mapping?.externalRef ?? null])).toEqual([
      ['backend', 'C1'],
      [project.slug, null],
    ])
    expect(rows[0]?.mapping?.extra).toEqual({ name: 'web', events: ['build.rejected'] })
  })
})

describe('integration links', () => {
  it('keeps one project-wide link per kind and subject, and any number per build', async () => {
    const { org, project } = await seedProject(t.db)
    const made = await createIntegration(t.db, {
      orgId: org.id,
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
  const { org, project } = await seedProject(t.db)
  const made = await createIntegration(t.db, {
    orgId: org.id,
    kind: 'figma',
    displayName: 'Figma',
    externalId: `F-${org.id}`,
  })
  return { org, project, made }
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

  it('lists a build’s links oldest first with their integration and author', async () => {
    const { project, made } = await seedFigma()
    const build = await seedBuild(t.db, project.id)
    for (const key of ['WEB-1', 'WEB-2']) {
      // oxlint-disable-next-line no-await-in-loop -- order matters
      await createIntegrationLink(t.db, {
        integrationId: made.id,
        buildId: build.id,
        kind: 'issue',
        externalRef: key,
        payload: { snapshotName: null },
      })
    }
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
    const { org, project, made } = await seedFigma()
    const linear = await createIntegration(t.db, {
      orgId: org.id,
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
      externalRef: 'team-1',
      extra: { name: 'Web' },
    })
    const mapped = await listProjectIntegrations(t.db, project.id, ['linear', 'jira'])
    expect(mapped.map((m) => [m.kind, m.externalRef, m.extra.name])).toEqual([
      ['linear', 'team-1', 'Web'],
    ])
    expect(await listProjectIntegrations(t.db, project.id, [])).toEqual([])
    expect((await getProjectIntegration(t.db, project.id, made.id))?.externalRef).toBe('FileKey')
    const other = await seedProject(t.db)
    expect(await getProjectIntegration(t.db, other.project.id, made.id)).toBeUndefined()
  })
})

describe('git connections as integrations', () => {
  it('connects without a project, counts projects, and disconnects like unlinking each one', async () => {
    const { org, project, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { org: { org, owner }, slug: 'backend' })
    const { id } = await connectGithub(t.db, org.id, '501')
    expect((await connectGithub(t.db, org.id, '501')).id).toBe(id)
    expect(await listGitConnections(t.db, org.id)).toEqual([
      expect.objectContaining({ id, kind: 'github', externalId: '501', projectCount: 0 }),
    ])

    await linkProjectToGithub(t.db, project.id, { installationId: '501', repoRef: 'acme/web' })
    await linkProjectToGithub(t.db, second.project.id, {
      installationId: '501',
      repoRef: 'acme/api',
    })
    expect((await listGitConnections(t.db, org.id))[0]?.projectCount).toBe(2)
    expect(await listProjectRepoLinks(t.db, org.id)).toEqual([
      expect.objectContaining({ repoRef: 'acme/api', connectionExternalId: '501' }),
      expect.objectContaining({ repoRef: 'acme/web', connectionExternalId: '501' }),
    ])

    await markInstallationNeedsAttention(t.db, 'github', '501', 'installation_revoked')
    const unified = await listOrgIntegrations(t.db, org.id)
    expect(unified).toEqual([
      expect.objectContaining({
        id,
        source: 'connection',
        kind: 'github',
        group: 'git',
        needsAttention: true,
        attentionReason: 'installation_revoked',
        projectCount: 2,
      }),
    ])

    const stranger = await seedProject(t.db)
    expect(await removeGitConnection(t.db, stranger.org.id, id)).toBe(false)
    expect(await getGitConnection(t.db, org.id, id)).toBeDefined()
    expect(await removeGitConnection(t.db, org.id, id)).toBe(true)
    expect(await getProjectLink(t.db, project.id)).toBeUndefined()
    expect(await getProjectLink(t.db, second.project.id)).toBeUndefined()
    expect(await listGitConnections(t.db, org.id)).toEqual([])
  })

  it('lists git connections and other integrations together, git hosts first', async () => {
    const { org } = await seedProject(t.db)
    await createIntegration(t.db, {
      orgId: org.id,
      kind: 'figma',
      displayName: 'Design',
      externalId: 'f',
    })
    await createIntegration(t.db, {
      orgId: org.id,
      kind: 'slack',
      displayName: 'Chat',
      externalId: 's',
    })
    await connectGithub(t.db, org.id, '9')
    // Kinds are looked up by the caller (the server asks the registry, then the static catalog).
    const kinds = new Map<string, listOrgIntegrations.Kind>([
      ['github', { group: 'git', name: 'GitHub', pageStyle: 'custom' }],
      ['slack', { group: 'chat', name: 'Slack', pageStyle: 'generic' }],
      ['figma', { group: 'design', name: 'Figma', pageStyle: 'custom' }],
    ])
    const listed = await listOrgIntegrations(t.db, org.id, (kind) => kinds.get(kind))
    expect(listed.map((i) => [i.kind, i.group, i.name])).toEqual([
      ['github', 'git', 'Installation 9'],
      ['slack', 'chat', 'Chat'],
      ['figma', 'design', 'Design'],
    ])
  })
})
