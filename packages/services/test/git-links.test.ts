import {
  getIntegration,
  getProjectGitAttention,
  getProjectLink,
  listProjectIntegrations,
  markInstallationNeedsAttention,
  NotFoundError,
  schema,
} from '@circi/db'
import { integrationRegistry } from '@circi/integrations'
import { createTestDb, seedGitLink, seedProject } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { gitKinds, linkProjectToGithub, mapProject, unlinkProjectFromGit } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('git hosts and the registry', () => {
  it('knows the git kinds from the definitions', () => {
    expect(gitKinds().toSorted()).toEqual(['bitbucket', 'github', 'gitlab'])
  })
})

describe('linkProjectToGithub', () => {
  it('connects the installation if it is new, reuses it, and unlinks', async () => {
    const { project, org, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { org: { org, owner }, slug: 'backend' })
    expect(await getProjectLink(t.db, project.id, gitKinds())).toBeUndefined()

    await linkProjectToGithub(t.db, project.id, { installationId: '42', repoRef: 'Acme/Web' })
    await linkProjectToGithub(t.db, second.project.id, {
      installationId: '42',
      repoRef: 'acme/api',
    })
    expect(await getProjectLink(t.db, project.id, gitKinds())).toEqual({
      installationId: '42',
      repoRef: 'Acme/Web',
    })
    const connections = (await t.db.select().from(schema.integrations)).filter(
      (i) => i.orgId === org.id,
    )
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({ kind: 'github', displayName: 'Installation 42' })

    await unlinkProjectFromGit(t.db, project.id)
    expect(await getProjectLink(t.db, project.id, gitKinds())).toBeUndefined()
    expect(await getProjectLink(t.db, second.project.id, gitKinds())).toBeDefined()
  })

  it('clears a needs-attention mark, as saying "I reinstalled the App" does', async () => {
    const { project } = await seedProject(t.db)
    await linkProjectToGithub(t.db, project.id, { installationId: '555', repoRef: 'a/one' })
    await markInstallationNeedsAttention(t.db, 'github', '555', 'gone')
    expect(await getProjectGitAttention(t.db, project.id, gitKinds())).toBeDefined()
    await linkProjectToGithub(t.db, project.id, { installationId: '555', repoRef: 'a/one' })
    expect(await getProjectGitAttention(t.db, project.id, gitKinds())).toBeUndefined()
  })

  it('refuses a project that does not exist', async () => {
    await expect(
      linkProjectToGithub(t.db, '00000000-0000-0000-0000-000000000000', {
        installationId: '1',
        repoRef: 'a/b',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('moves a project that reported to another git host: one git host per project', async () => {
    const { project } = await seedProject(t.db)
    await seedGitLink(t.db, project.id, { kind: 'gitlab', externalId: 'h#1', repoRef: 'g/h' })
    await linkProjectToGithub(t.db, project.id, { installationId: '9', repoRef: 'a/b' })
    expect(
      (await listProjectIntegrations(t.db, project.id, gitKinds())).map((i) => i.kind),
    ).toEqual(['github'])
  })
})

describe('mapProject with exclusive', () => {
  it('moves a project between connections of a kind, clearing attention of the git host it maps to', async () => {
    const { project } = await seedProject(t.db)
    const github = integrationRegistry.get('github')
    if (!github) throw new Error('github is registered')
    const a = await seedGitLink(t.db, project.id, { externalId: '1', repoRef: 'x/y' })
    const b = await seedGitLink(t.db, project.id, { externalId: '2', repoRef: 'x/y' })
    await markInstallationNeedsAttention(t.db, 'github', '2', 'gone')
    await mapProject(t.db, {
      definition: github,
      integrationId: b.integrationId,
      projectId: project.id,
      ref: 'x/z',
      extra: {},
    })
    const mapped = await listProjectIntegrations(t.db, project.id, ['github'])
    expect(mapped.map((m) => [m.integrationId, m.externalRef])).toEqual([[b.integrationId, 'x/z']])
    expect((await getIntegration(t.db, project.orgId, b.integrationId))?.needsAttention).toBe(false)
    expect(await getIntegration(t.db, project.orgId, a.integrationId)).toBeDefined()
  })
})
