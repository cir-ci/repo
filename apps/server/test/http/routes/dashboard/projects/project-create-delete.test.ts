import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser, verifyProjectToken } from '@circi/auth'
import { getWorkspaceBySlug } from '@circi/db/queries'
import { createIntegration } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { createTestDb, seedBuild, seedScreenshot } from '@circi/db/testing'
import { runRetention } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, addMember } from '#test/support/helpers.ts'

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-project-create-'))
const auth = createTestAuth(t.db)
const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: 'instance-secret-long-enough-for-test',
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
  email: 'lou-project@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, t.db, { workspaceSlug: acme.workspaceSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')
const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)

const call = caller(() => app)

const createUrl = `/api/workspaces/${acme.workspaceSlug}/projects`
const bitbucket = await createIntegration(t.db, {
  workspaceId: workspace.id,
  kind: 'bitbucket',
  displayName: 'Acme',
  externalId: 'acme-ws',
})
const mappings = async (projectSlug: string) =>
  t.db
    .select({
      ref: schema.integrationProjects.externalRef,
      extra: schema.integrationProjects.extra,
    })
    .from(schema.integrationProjects)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.integrationProjects.projectId))
    .where(eq(schema.projects.slug, projectSlug))

describe('GET /api/capabilities', () => {
  it('says whether the person runs the instance', async () => {
    const asMember = await call('GET', '/api/capabilities', louCookie)
    expect(asMember.json().instanceAdmin).toBe(false)
    const admin = await createUser(auth, {
      email: 'root@acme.test',
      name: 'Root',
      password: 'root-password-long-1',
      instanceAdmin: true,
    })
    const cookie = await signIn(app, admin.email, 'root-password-long-1')
    expect((await call('GET', '/api/capabilities', cookie)).json().instanceAdmin).toBe(true)
  })
})

describe('POST /api/workspaces/:workspace/projects with a branch and a repository', () => {
  it('creates the project on that branch and points it at the repository in one call', async () => {
    const res = await call('POST', createUrl, ownerCookie, {
      name: 'Mapped',
      defaultBranch: 'trunk',
      repository: { integration: bitbucket.id, ref: 'acme-ws/web' },
    })
    expect(res.statusCode).toBe(201)
    const [project] = await t.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.slug, 'mapped'))
    expect(project?.defaultBranch).toBe('trunk')
    expect(await mappings('mapped')).toEqual([
      { ref: 'acme-ws/web', extra: { name: 'acme-ws/web' } },
    ])
  })

  it("creates nothing when the repository is not one of the workspace's integrations", async () => {
    const rivalWorkspace = await getWorkspaceBySlug(t.db, rival.workspaceSlug)
    const foreign = await createIntegration(t.db, {
      workspaceId: rivalWorkspace.id,
      kind: 'bitbucket',
      displayName: 'Rival',
      externalId: 'rival-ws',
    })
    for (const repository of [
      { integration: foreign.id, ref: 'rival-ws/web' },
      { integration: crypto.randomUUID(), ref: 'acme-ws/web' },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- in order
      const res = await call('POST', createUrl, ownerCookie, { name: 'Nope', repository })
      expect(res.statusCode).toBe(400)
    }
    const found = await t.db.select().from(schema.projects).where(eq(schema.projects.slug, 'nope'))
    expect(found).toEqual([])
  })
})

describe('DELETE /api/projects/:workspace/:project', () => {
  it('is for owners and admins of the workspace, and hides it from outsiders', async () => {
    const url = `/api/projects/${acme.workspaceSlug}/${acme.project.slug}`
    expect((await call('DELETE', url, rivalCookie)).statusCode).toBe(404)
    expect((await call('DELETE', url, louCookie)).statusCode).toBe(403)
    expect((await call('GET', `${url}/settings`, ownerCookie)).statusCode).toBe(200)
  })

  it('removes the project with its builds and mappings, revokes its token, and leaves the files to retention', async () => {
    const made = (await call('POST', createUrl, ownerCookie, { name: 'Doomed' })).json()
    const [project] = await t.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.slug, 'doomed'))
    if (!project) throw new Error('project missing')
    const build = await seedBuild(t.db, project.id)
    const sha = 'd'.repeat(64)
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha })
    expect(await verifyProjectToken(auth, t.db, made.token)).toBeTruthy()

    const res = await call('DELETE', `/api/projects/${acme.workspaceSlug}/doomed`, ownerCookie)
    expect(res.statusCode).toBe(204)
    expect(
      await t.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)),
    ).toEqual([])
    expect(
      await t.db.select().from(schema.builds).where(eq(schema.builds.projectId, project.id)),
    ).toEqual([])
    expect(await verifyProjectToken(auth, t.db, made.token)).toBeFalsy()
    expect(
      (await call('GET', `/api/projects/${acme.workspaceSlug}/doomed/settings`, ownerCookie))
        .statusCode,
    ).toBe(404)

    // Nothing points at the file now: retention marks it, then collects it after the grace period.
    const deleted: string[] = []
    const now = new Date()
    await runRetention(t.db, { now, deleteObject: async (key) => void deleted.push(key) })
    await runRetention(t.db, {
      now: new Date(now.getTime() + 25 * 3600_000),
      deleteObject: async (key) => void deleted.push(key),
    })
    expect(deleted).toContain(`k/${sha}`)
  })
})
