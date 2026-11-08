import { createTestDb, seedProject, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConflictError } from '#src/errors.ts'
import {
  connectGithub,
  createIntegration,
  deleteIntegration,
  getGitConnection,
  getIntegration,
  getProjectLink,
  linkProjectToGithub,
  listGitConnections,
  listIntegrationProjects,
  listIntegrations,
  listOrgIntegrations,
  listProjectRepoLinks,
  markInstallationNeedsAttention,
  removeGitConnection,
  removeIntegrationProject,
  setIntegrationAttention,
  setIntegrationProject,
} from '#src/index.ts'

let t: TestDb
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

  it('refuses kinds the table does not allow', async () => {
    const { org } = await seedProject(t.db)
    await expect(
      createIntegration(t.db, {
        orgId: org.id,
        // @ts-expect-error not an integration kind (yet)
        kind: 'teams',
        displayName: 'x',
        externalId: 'x',
      }),
    ).rejects.toThrow(/insert into "integrations"/)
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
    expect((await listOrgIntegrations(t.db, org.id)).map((i) => [i.kind, i.group, i.name])).toEqual(
      [
        ['github', 'git', 'Installation 9'],
        ['slack', 'chat', 'Chat'],
        ['figma', 'design', 'Design'],
      ],
    )
  })
})
