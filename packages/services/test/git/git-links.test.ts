import { NotFoundError } from '@circi/db'
import {
  getIntegration,
  getProjectGitAttention,
  getProjectLink,
  listProjectIntegrations,
} from '@circi/db/queries'
import { markInstallationNeedsAttention } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import { createTestDb, seedGitConnection, seedGitLink, seedProject } from '@circi/db/testing'
import { type IntegrationDefinition, integrationRegistry } from '@circi/integrations'
import { TEST_AUTH_SECRET } from '@circi/testing'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { linkProjectToGithub, mapProject, unlinkProjectFromGit } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('git hosts and the registry', () => {
  it('knows the git kinds from the definitions', () => {
    expect(integrationRegistry.gitKinds().toSorted()).toEqual(['bitbucket', 'github', 'gitlab'])
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
    authSecret: TEST_AUTH_SECRET,
    publicOrigin: 'https://ci.acme.io',
    config: {},
    gitProviders: { github: provider },
  }
  return { ctx, asked }
}

describe('linkProjectToGithub', () => {
  it('verifies the installation, connects it if it is new, reuses it, and unlinks', async () => {
    const { project, workspace, owner } = await seedProject(t.db)
    const second = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'backend' })
    const { ctx, asked } = githubFake(['42'])
    expect(await getProjectLink(t.db, project.id, integrationRegistry.gitKinds())).toBeUndefined()

    await linkProjectToGithub(t.db, project.id, { installationId: '42', repoRef: 'Acme/Web' }, ctx)
    await linkProjectToGithub(
      t.db,
      second.project.id,
      { installationId: '42', repoRef: 'acme/api' },
      ctx,
    )
    expect(asked).toEqual(['42', '42'])
    expect(await getProjectLink(t.db, project.id, integrationRegistry.gitKinds())).toEqual({
      installationId: '42',
      repoRef: 'Acme/Web',
    })
    const connections = (await t.db.select().from(schema.integrations)).filter(
      (i) => i.workspaceId === workspace.id,
    )
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({ kind: 'github', displayName: 'Installation 42' })

    await unlinkProjectFromGit(t.db, project.id)
    expect(await getProjectLink(t.db, project.id, integrationRegistry.gitKinds())).toBeUndefined()
    expect(
      await getProjectLink(t.db, second.project.id, integrationRegistry.gitKinds()),
    ).toBeDefined()
  })

  it('stores nothing when GitHub does not know the installation or does not answer', async () => {
    const { project } = await seedProject(t.db)
    const { ctx } = githubFake([])
    const before = (await t.db.select().from(schema.integrations)).length
    await expect(
      linkProjectToGithub(t.db, project.id, { installationId: '777', repoRef: 'a/b' }, ctx),
    ).rejects.toMatchObject({ code: 'unreachable' })
    expect((await t.db.select().from(schema.integrations)).length).toBe(before)
    expect(await getProjectLink(t.db, project.id, integrationRegistry.gitKinds())).toBeUndefined()
  })

  it('refuses an installation another workspace already uses (409), changing nothing', async () => {
    const mine = await seedProject(t.db)
    const theirs = await seedProject(t.db)
    const { ctx } = githubFake(['888'])
    await linkProjectToGithub(
      t.db,
      theirs.project.id,
      { installationId: '888', repoRef: 'o/x' },
      ctx,
    )
    await expect(
      linkProjectToGithub(t.db, mine.project.id, { installationId: '888', repoRef: 'o/y' }, ctx),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(
      await getProjectLink(t.db, mine.project.id, integrationRegistry.gitKinds()),
    ).toBeUndefined()
    expect(
      (await t.db.select().from(schema.integrations)).filter(
        (i) => i.workspaceId === mine.workspace.id,
      ),
    ).toEqual([])
  })

  it('refuses an id that is not a number, and an instance with no GitHub App', async () => {
    const { project } = await seedProject(t.db)
    const { ctx, asked } = githubFake(['1'])
    await expect(
      linkProjectToGithub(t.db, project.id, { installationId: 'abc', repoRef: 'a/b' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(asked).toEqual([])
    const bare: IntegrationDefinition.Context = { ...ctx, gitProviders: {} }
    await expect(
      linkProjectToGithub(t.db, project.id, { installationId: '1', repoRef: 'a/b' }, bare),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('clears a needs-attention mark, as saying "I reinstalled the App" does', async () => {
    const { project } = await seedProject(t.db)
    const { ctx } = githubFake(['555'])
    await linkProjectToGithub(t.db, project.id, { installationId: '555', repoRef: 'a/one' }, ctx)
    await markInstallationNeedsAttention(t.db, 'github', '555', 'gone')
    expect(
      await getProjectGitAttention(t.db, project.id, integrationRegistry.gitKinds()),
    ).toBeDefined()
    await linkProjectToGithub(t.db, project.id, { installationId: '555', repoRef: 'a/one' }, ctx)
    expect(
      await getProjectGitAttention(t.db, project.id, integrationRegistry.gitKinds()),
    ).toBeUndefined()
  })

  it('refuses a project that does not exist', async () => {
    const { ctx } = githubFake(['1'])
    await expect(
      linkProjectToGithub(
        t.db,
        '00000000-0000-0000-0000-000000000000',
        { installationId: '1', repoRef: 'a/b' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('moves a project that reported to another git host: one git host per project', async () => {
    const { project } = await seedProject(t.db)
    const { ctx } = githubFake(['9'])
    await seedGitLink(t.db, project.id, { kind: 'gitlab', externalId: 'h#1', repoRef: 'g/h' })
    await linkProjectToGithub(t.db, project.id, { installationId: '9', repoRef: 'a/b' }, ctx)
    expect(
      (await listProjectIntegrations(t.db, project.id, integrationRegistry.gitKinds())).map(
        (i) => i.kind,
      ),
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
    expect((await getIntegration(t.db, project.workspaceId, b.integrationId))?.needsAttention).toBe(
      false,
    )
    expect(await getIntegration(t.db, project.workspaceId, a.integrationId)).toBeDefined()
  })

  it('swaps installations in one transaction: a failure while dropping the old mapping keeps it, and the new one is not left half-made', async () => {
    const { project, workspace } = await seedProject(t.db)
    const github = integrationRegistry.get('github')
    if (!github) throw new Error('github is registered')
    const a = await seedGitLink(t.db, project.id, { externalId: '11', repoRef: 'x/y' })
    const b = await seedGitConnection(t.db, { workspaceId: workspace.id, externalId: '12' })
    // Dropping the old mapping fails, as it would on a crash in the middle of the swap.
    await t.db.execute(sql`
      create function circi_test_no_unmap() returns trigger as $$
      begin raise exception 'unmap failed'; end $$ language plpgsql`)
    await t.db.execute(sql`
      create trigger circi_test_no_unmap before delete on integration_projects
      for each row execute function circi_test_no_unmap()`)
    try {
      await expect(
        mapProject(t.db, {
          definition: github,
          integrationId: b.id,
          projectId: project.id,
          ref: 'x/y',
          extra: {},
        }),
      ).rejects.toThrow(/delete from "integration_projects"/)
    } finally {
      await t.db.execute(sql`drop trigger circi_test_no_unmap on integration_projects`)
      await t.db.execute(sql`drop function circi_test_no_unmap()`)
    }
    // Still exactly the old mapping: never none, never both.
    expect(
      (await listProjectIntegrations(t.db, project.id, integrationRegistry.gitKinds())).map(
        (m) => m.integrationId,
      ),
    ).toEqual([a.integrationId])
    expect(await getProjectLink(t.db, project.id, integrationRegistry.gitKinds())).toEqual({
      installationId: '11',
      repoRef: 'x/y',
    })

    await mapProject(t.db, {
      definition: github,
      integrationId: b.id,
      projectId: project.id,
      ref: 'x/y',
      extra: {},
    })
    expect(
      (await listProjectIntegrations(t.db, project.id, integrationRegistry.gitKinds())).map(
        (m) => m.integrationId,
      ),
    ).toEqual([b.id])
  })
})
