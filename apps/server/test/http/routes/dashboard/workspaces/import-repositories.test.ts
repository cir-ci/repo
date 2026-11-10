import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser } from '@circi/auth'
import {
  getTeamBySlugs,
  getTeamLink,
  getWorkspaceBySlug,
  listTeamMembers,
  listTeams,
} from '@circi/db/queries'
import { createTeam } from '@circi/db/repositories'
import { createTestDb, seedGitConnection, seedGitLink } from '@circi/db/testing'
import { integrationRegistry } from '@circi/integrations'
import { providerRegistry } from '@circi/integrations/git'
import { FsStorage } from '@circi/storage'
import { pino } from 'pino'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { addMember, createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const AUTH_SECRET = 'instance-secret-long-enough-for-test'
const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-github-import-'))
const auth = createTestAuth(t.db)

/** GitHub's edge: the repositories installation 42 can see, and whether it answers. */
const github = {
  down: false,
  repositories: [
    { ref: 'acme/web-app', private: true },
    { ref: 'acme/design-system', private: false },
    { ref: 'acme/api', private: false },
    { ref: 'acme/docs', private: false },
  ],
  listRepositories: async (installationId: string) => {
    if (github.down) throw new Error('connect ETIMEDOUT')
    return installationId === '42' ? github.repositories : []
  },
}
const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: AUTH_SECRET,
    providers: providerRegistry({ github }),
  },
})
await app.ready()
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const acme = await seedTenant(auth, t.db)
const rival = await seedTenant(auth, t.db)
const ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
const lou = await createUser(auth, {
  email: 'lou@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, t.db, { workspaceSlug: acme.workspaceSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const call = caller(() => app)
const url = `/api/workspaces/${acme.workspaceSlug}/github-import`
const reset = await snapshotDb(t)
beforeEach(async () => {
  await reset()
  github.down = false
})

const installation = async () =>
  seedGitConnection(t.db, { workspaceId: await workspaceId(), externalId: '42' })
const workspaceId = async () => (await getWorkspaceBySlug(t.db, acme.workspaceSlug)).id

describe('GET /api/workspaces/:workspace/github-import', () => {
  it('is for owners and admins of the workspace', async () => {
    await installation()
    expect((await call('GET', url, '')).statusCode).toBe(401)
    expect((await call('GET', url, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', url, louCookie)).statusCode).toBe(403)
  })

  it('is not found when the workspace has no GitHub installation', async () => {
    expect((await call('GET', url, ownerCookie)).statusCode).toBe(404)
  })

  it('lists the installation repositories no team is linked to', async () => {
    const { id } = await installation()
    const { team } = await seedLinkedTeam('acme/design-system')
    expect(team).toBeDefined()
    const res = await call('GET', url, ownerCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      repositories: [
        { integration: id, installation: 'Installation 42', ref: 'acme/api', private: false },
        { integration: id, installation: 'Installation 42', ref: 'acme/docs', private: false },
        { integration: id, installation: 'Installation 42', ref: 'acme/web-app', private: true },
      ],
    })
  })

  it("says so when GitHub doesn't answer", async () => {
    await installation()
    github.down = true
    expect((await call('GET', url, ownerCookie)).statusCode).toBe(502)
  })
})

/** A team of Acme already linked to a repository of installation 42. */
async function seedLinkedTeam(repoRef: string) {
  const team = await createTeam(t.db, { workspaceSlug: acme.workspaceSlug, name: 'Existing' })
  await seedGitLink(t.db, team.id, { externalId: '42', repoRef })
  return { team }
}

describe('POST /api/workspaces/:workspace/github-import', () => {
  it('makes one linked team per repository, with the importer as a member', async () => {
    const { id } = await installation()
    const res = await call('POST', url, ownerCookie, {
      repositories: [
        { integration: id, ref: 'acme/web-app' },
        { integration: id, ref: 'ACME/API' },
      ],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({
      teams: [
        { slug: 'web-app', name: 'web-app', repository: 'acme/web-app' },
        // "api" is a reserved address, so the owner's name goes in front.
        { slug: 'acme-api', name: 'api', repository: 'acme/api' },
      ],
    })
    const team = await getTeamBySlugs(t.db, {
      workspaceSlug: acme.workspaceSlug,
      teamSlug: 'web-app',
    })
    expect(await getTeamLink(t.db, team.id, integrationRegistry.gitKinds())).toEqual({
      installationId: '42',
      repoRef: 'acme/web-app',
    })
    expect((await listTeamMembers(t.db, team.id)).map((m) => m.id)).toEqual([acme.owner.id])
    // What is left to import: the other two repositories.
    const left = await call('GET', url, ownerCookie)
    expect(left.json().repositories.map((r: { ref: string }) => r.ref)).toEqual([
      'acme/design-system',
      'acme/docs',
    ])
  })

  it('puts the owner in front of the address when the name is taken', async () => {
    const { id } = await installation()
    await createTeam(t.db, { workspaceSlug: acme.workspaceSlug, name: 'docs' })
    const res = await call('POST', url, ownerCookie, {
      repositories: [{ integration: id, ref: 'acme/docs' }],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().teams).toEqual([{ slug: 'acme-docs', name: 'docs', repository: 'acme/docs' }])
  })

  it('creates nothing when one repository is not left to import', async () => {
    const { id } = await installation()
    await seedLinkedTeam('acme/design-system')
    for (const repositories of [
      [],
      [{ integration: id, ref: 'acme/not-installed' }],
      [
        { integration: id, ref: 'acme/web-app' },
        { integration: id, ref: 'acme/design-system' },
      ],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- in order
      expect((await call('POST', url, ownerCookie, { repositories })).statusCode).toBe(400)
    }
    expect((await listTeams(t.db, acme.workspaceSlug)).map((x) => x.slug)).toEqual([
      'existing',
      'web',
    ])
  })

  it('is for owners and admins, and checks the body', async () => {
    const { id } = await installation()
    const body = { repositories: [{ integration: id, ref: 'acme/web-app' }] }
    expect((await call('POST', url, '', body)).statusCode).toBe(401)
    expect((await call('POST', url, rivalCookie, body)).statusCode).toBe(404)
    expect((await call('POST', url, louCookie, body)).statusCode).toBe(403)
    expect(
      (await call('POST', url, ownerCookie, { repositories: 'acme/web-app' })).statusCode,
    ).toBe(400)
    expect(
      (await call('POST', url, ownerCookie, { repositories: [{ integration: 'x', ref: 'a/b' }] }))
        .statusCode,
    ).toBe(400)
  })
})
