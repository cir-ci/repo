import {
  getIntegration,
  getTeamGitAttention,
  getTeamLink,
  listTeamIntegrations,
  markInstallationNeedsAttention,
  NotFoundError,
  schema,
} from '@circi/db'
import { integrationRegistry } from '@circi/integrations'
import { createTestDb, seedGitLink, seedTeam } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { gitKinds, linkTeamToGithub, mapTeam, unlinkTeamFromGit } from '#src/index.ts'

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

describe('linkTeamToGithub', () => {
  it('connects the installation if it is new, reuses it, and unlinks', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const second = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'backend' })
    expect(await getTeamLink(t.db, team.id, gitKinds())).toBeUndefined()

    await linkTeamToGithub(t.db, team.id, { installationId: '42', repoRef: 'Acme/Web' })
    await linkTeamToGithub(t.db, second.team.id, {
      installationId: '42',
      repoRef: 'acme/api',
    })
    expect(await getTeamLink(t.db, team.id, gitKinds())).toEqual({
      installationId: '42',
      repoRef: 'Acme/Web',
    })
    const connections = (await t.db.select().from(schema.integrations)).filter(
      (i) => i.workspaceId === workspace.id,
    )
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({ kind: 'github', displayName: 'Installation 42' })

    await unlinkTeamFromGit(t.db, team.id)
    expect(await getTeamLink(t.db, team.id, gitKinds())).toBeUndefined()
    expect(await getTeamLink(t.db, second.team.id, gitKinds())).toBeDefined()
  })

  it('clears a needs-attention mark, as saying "I reinstalled the App" does', async () => {
    const { team } = await seedTeam(t.db)
    await linkTeamToGithub(t.db, team.id, { installationId: '555', repoRef: 'a/one' })
    await markInstallationNeedsAttention(t.db, 'github', '555', 'gone')
    expect(await getTeamGitAttention(t.db, team.id, gitKinds())).toBeDefined()
    await linkTeamToGithub(t.db, team.id, { installationId: '555', repoRef: 'a/one' })
    expect(await getTeamGitAttention(t.db, team.id, gitKinds())).toBeUndefined()
  })

  it('refuses a team that does not exist', async () => {
    await expect(
      linkTeamToGithub(t.db, '00000000-0000-0000-0000-000000000000', {
        installationId: '1',
        repoRef: 'a/b',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('moves a team that reported to another git host: one git host per team', async () => {
    const { team } = await seedTeam(t.db)
    await seedGitLink(t.db, team.id, { kind: 'gitlab', externalId: 'h#1', repoRef: 'g/h' })
    await linkTeamToGithub(t.db, team.id, { installationId: '9', repoRef: 'a/b' })
    expect((await listTeamIntegrations(t.db, team.id, gitKinds())).map((i) => i.kind)).toEqual([
      'github',
    ])
  })
})

describe('mapTeam with exclusive', () => {
  it('moves a team between connections of a kind, clearing attention of the git host it maps to', async () => {
    const { team } = await seedTeam(t.db)
    const github = integrationRegistry.get('github')
    if (!github) throw new Error('github is registered')
    const a = await seedGitLink(t.db, team.id, { externalId: '1', repoRef: 'x/y' })
    const b = await seedGitLink(t.db, team.id, { externalId: '2', repoRef: 'x/y' })
    await markInstallationNeedsAttention(t.db, 'github', '2', 'gone')
    await mapTeam(t.db, {
      definition: github,
      integrationId: b.integrationId,
      teamId: team.id,
      ref: 'x/z',
      extra: {},
    })
    const mapped = await listTeamIntegrations(t.db, team.id, ['github'])
    expect(mapped.map((m) => [m.integrationId, m.externalRef])).toEqual([[b.integrationId, 'x/z']])
    expect((await getIntegration(t.db, team.workspaceId, b.integrationId))?.needsAttention).toBe(
      false,
    )
    expect(await getIntegration(t.db, team.workspaceId, a.integrationId)).toBeDefined()
  })
})
