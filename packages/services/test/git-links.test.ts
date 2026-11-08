import {
  getIntegration,
  getTeamGitAttention,
  getTeamLink,
  listTeamIntegrations,
  markInstallationNeedsAttention,
  NotFoundError,
  schema,
} from '@circi/db'
import { type IntegrationDefinition, integrationRegistry } from '@circi/integrations'
import { createTestDb, seedGitConnection, seedGitLink, seedTeam } from '@circi/testing'
import { sql } from 'drizzle-orm'
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

/** GitHub's edge: these installations exist; every other id fails as `failure` says. */
function githubFake(installed: string[], failure: Error = new Error('connect ETIMEDOUT')) {
  const asked: string[] = []
  const provider = {
    listRepositories: async (installationId: string) => {
      asked.push(installationId)
      if (!installed.includes(installationId)) throw failure
      return [{ ref: 'acme/web' }]
    },
  }
  const ctx: IntegrationDefinition.Context = {
    authSecret: 'test-secret-that-is-long-enough-123',
    publicOrigin: 'https://ci.acme.io',
    config: {},
    gitProviders: { github: provider },
  }
  return { ctx, asked }
}

describe('linkTeamToGithub', () => {
  it('verifies the installation, connects it if it is new, reuses it, and unlinks', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const second = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'backend' })
    const { ctx, asked } = githubFake(['42'])
    expect(await getTeamLink(t.db, team.id, gitKinds())).toBeUndefined()

    await linkTeamToGithub(t.db, team.id, { installationId: '42', repoRef: 'Acme/Web' }, ctx)
    await linkTeamToGithub(t.db, second.team.id, { installationId: '42', repoRef: 'acme/api' }, ctx)
    expect(asked).toEqual(['42', '42'])
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

  it('stores nothing when GitHub does not know the installation or does not answer', async () => {
    const { team } = await seedTeam(t.db)
    const { ctx } = githubFake([])
    const before = (await t.db.select().from(schema.integrations)).length
    await expect(
      linkTeamToGithub(t.db, team.id, { installationId: '777', repoRef: 'a/b' }, ctx),
    ).rejects.toMatchObject({ status: 502 })
    expect((await t.db.select().from(schema.integrations)).length).toBe(before)
    expect(await getTeamLink(t.db, team.id, gitKinds())).toBeUndefined()
  })

  it('refuses an installation another workspace already uses (409), changing nothing', async () => {
    const mine = await seedTeam(t.db)
    const theirs = await seedTeam(t.db)
    const { ctx } = githubFake(['888'])
    await linkTeamToGithub(t.db, theirs.team.id, { installationId: '888', repoRef: 'o/x' }, ctx)
    await expect(
      linkTeamToGithub(t.db, mine.team.id, { installationId: '888', repoRef: 'o/y' }, ctx),
    ).rejects.toMatchObject({ status: 409 })
    expect(await getTeamLink(t.db, mine.team.id, gitKinds())).toBeUndefined()
    expect(
      (await t.db.select().from(schema.integrations)).filter(
        (i) => i.workspaceId === mine.workspace.id,
      ),
    ).toEqual([])
  })

  it('refuses an id that is not a number, and an instance with no GitHub App', async () => {
    const { team } = await seedTeam(t.db)
    const { ctx, asked } = githubFake(['1'])
    await expect(
      linkTeamToGithub(t.db, team.id, { installationId: 'abc', repoRef: 'a/b' }, ctx),
    ).rejects.toMatchObject({ status: 400 })
    expect(asked).toEqual([])
    const bare: IntegrationDefinition.Context = { ...ctx, gitProviders: {} }
    await expect(
      linkTeamToGithub(t.db, team.id, { installationId: '1', repoRef: 'a/b' }, bare),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('clears a needs-attention mark, as saying "I reinstalled the App" does', async () => {
    const { team } = await seedTeam(t.db)
    const { ctx } = githubFake(['555'])
    await linkTeamToGithub(t.db, team.id, { installationId: '555', repoRef: 'a/one' }, ctx)
    await markInstallationNeedsAttention(t.db, 'github', '555', 'gone')
    expect(await getTeamGitAttention(t.db, team.id, gitKinds())).toBeDefined()
    await linkTeamToGithub(t.db, team.id, { installationId: '555', repoRef: 'a/one' }, ctx)
    expect(await getTeamGitAttention(t.db, team.id, gitKinds())).toBeUndefined()
  })

  it('refuses a team that does not exist', async () => {
    const { ctx } = githubFake(['1'])
    await expect(
      linkTeamToGithub(
        t.db,
        '00000000-0000-0000-0000-000000000000',
        { installationId: '1', repoRef: 'a/b' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('moves a team that reported to another git host: one git host per team', async () => {
    const { team } = await seedTeam(t.db)
    const { ctx } = githubFake(['9'])
    await seedGitLink(t.db, team.id, { kind: 'gitlab', externalId: 'h#1', repoRef: 'g/h' })
    await linkTeamToGithub(t.db, team.id, { installationId: '9', repoRef: 'a/b' }, ctx)
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

  it('swaps installations in one transaction: a failure while dropping the old mapping keeps it, and the new one is not left half-made', async () => {
    const { team, workspace } = await seedTeam(t.db)
    const github = integrationRegistry.get('github')
    if (!github) throw new Error('github is registered')
    const a = await seedGitLink(t.db, team.id, { externalId: '11', repoRef: 'x/y' })
    const b = await seedGitConnection(t.db, { workspaceId: workspace.id, externalId: '12' })
    // Dropping the old mapping fails, as it would on a crash in the middle of the swap.
    await t.db.execute(sql`
      create function circi_test_no_unmap() returns trigger as $$
      begin raise exception 'unmap failed'; end $$ language plpgsql`)
    await t.db.execute(sql`
      create trigger circi_test_no_unmap before delete on integration_teams
      for each row execute function circi_test_no_unmap()`)
    try {
      await expect(
        mapTeam(t.db, {
          definition: github,
          integrationId: b.id,
          teamId: team.id,
          ref: 'x/y',
          extra: {},
        }),
      ).rejects.toThrow(/delete from "integration_teams"/)
    } finally {
      await t.db.execute(sql`drop trigger circi_test_no_unmap on integration_teams`)
      await t.db.execute(sql`drop function circi_test_no_unmap()`)
    }
    // Still exactly the old mapping: never none, never both.
    expect(
      (await listTeamIntegrations(t.db, team.id, gitKinds())).map((m) => m.integrationId),
    ).toEqual([a.integrationId])
    expect(await getTeamLink(t.db, team.id, gitKinds())).toEqual({
      installationId: '11',
      repoRef: 'x/y',
    })

    await mapTeam(t.db, {
      definition: github,
      integrationId: b.id,
      teamId: team.id,
      ref: 'x/y',
      extra: {},
    })
    expect(
      (await listTeamIntegrations(t.db, team.id, gitKinds())).map((m) => m.integrationId),
    ).toEqual([b.id])
  })
})
