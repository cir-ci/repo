import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import type { Auth } from '@circi/auth'
import { getWorkspaceSettings, getTeamById, listWebhooks } from '@circi/db/queries'
import { recordWebhookDelivery, markInstallationNeedsAttention } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { providerRegistry } from '@circi/integrations/git'
import { GithubApiError, GithubInstallationRevokedError } from '@circi/integrations/github'
import { FsStorage } from '@circi/storage'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

/** Installations GitHub knows; `9500` is one it cannot be asked about right now. */
const githubEdge = providerRegistry<object>({
  github: {
    listRepositories: async (installationId: string) => {
      if (installationId === '9500') throw new Error('connect ETIMEDOUT')
      if (!/^(4242|4243|4244)$/.test(installationId)) {
        throw new GithubInstallationRevokedError(
          installationId,
          new GithubApiError(404, 'GitHub: Not Found'),
        )
      }
      return [{ ref: 'acme/web' }]
    },
  },
})

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let auth: Auth
let acme: Tenant
let rival: Tenant
let ownerCookie: string
let memberCookie: string
let rivalCookie: string
let reset: () => Promise<void>

beforeAll(async () => {
  t = await createTestDb()
  auth = createTestAuth(t.db)
  dir = await mkdtemp(join(tmpdir(), 'circi-settings-'))
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: join(dir, 'files') }),
      publicOrigin: ORIGIN,
      githubApp: true,
      authSecret: 'settings-test-secret-long-enough-123',
      // GitHub's edge: these installations exist; any other id is "not found", 5xx ones time out.
      providers: githubEdge,
    },
  })
  await app.ready()
  acme = await seedTenant(auth, t.db)
  rival = await seedTenant(auth, t.db)
  const plain = await createUser(auth, {
    email: 'plain@acme.test',
    name: 'Plain',
    password: 'plain-password-long-1',
  })
  await addMember(auth, t.db, {
    workspaceSlug: acme.workspaceSlug,
    email: plain.email,
    role: 'member',
  })
  ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  memberCookie = await signIn(app, plain.email, 'plain-password-long-1')
  rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
  reset = await snapshotDb(t)
})
beforeEach(() => reset())
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const base = () => `/api/teams/${acme.workspaceSlug}/web`
const call = caller(() => app)

describe('team settings', () => {
  it('shows settings to members, and whether they can change them', async () => {
    const owner = (await call('GET', `${base()}/settings`, ownerCookie)).json()
    expect(owner.canManage).toBe(true)
    expect(owner.settings).toMatchObject({
      defaultBranch: 'main',
      blockMergeOnChanges: true,
      diffThreshold: 0,
      retentionDays: 30,
      reviewTargetHours: 24,
    })
    const member = (await call('GET', `${base()}/settings`, memberCookie)).json()
    expect(member.canManage).toBe(false)
  })

  it('lets an owner change settings, and only the ones sent', async () => {
    const res = await call('PATCH', `${base()}/settings`, ownerCookie, {
      blockMergeOnChanges: false,
      diffThreshold: 0.01,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings).toMatchObject({
      blockMergeOnChanges: false,
      diffThreshold: 0.01,
      defaultBranch: 'main',
    })
    expect((await getTeamById(t.db, acme.team.id))?.blockMergeOnChanges).toBe(false)
  })

  it('renames the team’s slug, and the old address stops working', async () => {
    const before = base()
    const res = await call('PATCH', `${before}/settings`, ownerCookie, { slug: 'web-renamed' })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings.slug).toBe('web-renamed')
    expect((await call('GET', `${before}/settings`, ownerCookie)).statusCode).toBe(404)
    const after = before.replace(/[^/]+$/, 'web-renamed')
    expect((await call('GET', `${after}/settings`, ownerCookie)).json().settings.slug).toBe(
      'web-renamed',
    )
    expect((await call('PATCH', `${after}/settings`, memberCookie, { slug: 'x' })).statusCode).toBe(
      403,
    )
    expect(
      (await call('PATCH', `${after}/settings`, ownerCookie, { slug: 'Bad Slug' })).statusCode,
    ).toBe(400)
  })

  it('rejects invalid values and unknown fields', async () => {
    const codes = await Promise.all(
      [
        { diffThreshold: 2 },
        { retentionDays: 0 },
        { defaultBranch: '  ' },
        { ciKeyId: 'x' },
        { reviewTargetHours: 0 },
      ].map(
        async (body) => (await call('PATCH', `${base()}/settings`, ownerCookie, body)).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400, 400, 400])
  })

  it('sets the review target in hours, and clears it with null', async () => {
    const set = await call('PATCH', `${base()}/settings`, ownerCookie, { reviewTargetHours: 8 })
    expect(set.json().settings.reviewTargetHours).toBe(8)
    const cleared = await call('PATCH', `${base()}/settings`, ownerCookie, {
      reviewTargetHours: null,
    })
    expect(cleared.json().settings.reviewTargetHours).toBeNull()
    await call('PATCH', `${base()}/settings`, ownerCookie, { reviewTargetHours: 24 })
  })

  it('lets a team inherit the workspace on flaky screenshots, or set its own', async () => {
    const got = (await call('GET', `${base()}/settings`, memberCookie)).json()
    // Nothing set: the team inherits, and the workspace blocks, as before.
    expect(got.settings.flakyBlocksMerge).toBeNull()
    expect(got.workspace).toEqual({ flakyBlocksMerge: true, retentionDays: 30 })

    const off = await call('PATCH', `${base()}/settings`, ownerCookie, { flakyBlocksMerge: false })
    expect(off.json().settings.flakyBlocksMerge).toBe(false)
    expect((await getTeamById(t.db, acme.team.id))?.flakyBlocksMerge).toBe(false)

    const inherit = await call('PATCH', `${base()}/settings`, ownerCookie, {
      flakyBlocksMerge: null,
    })
    expect(inherit.json().settings.flakyBlocksMerge).toBeNull()
    expect((await getTeamById(t.db, acme.team.id))?.flakyBlocksMerge).toBeNull()

    const bad = await call('PATCH', `${base()}/settings`, ownerCookie, { flakyBlocksMerge: 'no' })
    expect(bad.statusCode).toBe(400)
  })

  it('refuses plain members with 403 and outsiders with 404', async () => {
    expect(
      (await call('PATCH', `${base()}/settings`, memberCookie, { name: 'x' })).statusCode,
    ).toBe(403)
    expect((await call('GET', `${base()}/settings`, rivalCookie)).statusCode).toBe(404)
    expect((await call('PATCH', `${base()}/settings`, rivalCookie, { name: 'x' })).statusCode).toBe(
      404,
    )
  })
})

/** Adds a webhook to Acme's team as its owner. */
async function addHook(url = 'https://hooks.acme.io/circi') {
  const res = await call('POST', `${base()}/webhooks`, ownerCookie, {
    url,
    events: ['build.reviewed'],
  })
  expect(res.statusCode).toBe(201)
  const { webhook }: { webhook: { id: string } } = res.json()
  return webhook
}

describe('team webhooks', () => {
  it('creates a webhook and shows the secret once', async () => {
    const res = await call('POST', `${base()}/webhooks`, ownerCookie, {
      url: 'https://hooks.acme.io/circi',
      events: ['build.reviewed'],
    })
    expect(res.statusCode).toBe(201)
    const { webhook, secret } = res.json()
    expect(secret).toMatch(/^whsec_/)
    expect(webhook).toMatchObject({
      url: 'https://hooks.acme.io/circi',
      events: ['build.reviewed'],
    })
    expect(webhook.secret).toBeUndefined()

    const listed = (await call('GET', `${base()}/settings`, memberCookie)).json()
    expect(listed.webhooks).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain('whsec_')
  })

  it('refuses addresses on private networks, bad schemes and unknown events', async () => {
    const codes = await Promise.all(
      [
        { url: 'http://169.254.169.254/latest' },
        { url: 'http://localhost:9000/x' },
        { url: 'ftp://hooks.acme.io' },
        { url: 'https://hooks.acme.io', events: ['build.exploded'] },
      ].map(
        async (body) => (await call('POST', `${base()}/webhooks`, ownerCookie, body)).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400, 400])
  })

  it('refuses a webhook with no events: missing or empty does not mean "all"', async () => {
    await addHook()
    const url = 'https://hooks.acme.io/none'
    for (const body of [{ url }, { url, events: [] }]) {
      // eslint-disable-next-line no-await-in-loop -- two requests
      const res = await call('POST', `${base()}/webhooks`, ownerCookie, body)
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('Choose at least one event for the webhook to receive')
    }
    expect(await listWebhooks(t.db, acme.team.id)).toHaveLength(1)
  })

  it('keeps plain members and outsiders from adding or removing webhooks', async () => {
    const hook = await addHook()
    const body = { url: 'https://hooks.acme.io/other' }
    expect((await call('POST', `${base()}/webhooks`, memberCookie, body)).statusCode).toBe(403)
    expect((await call('POST', `${base()}/webhooks`, rivalCookie, body)).statusCode).toBe(404)
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, memberCookie)).statusCode).toBe(
      403,
    )
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, rivalCookie)).statusCode).toBe(
      404,
    )
  })

  it('queues a signed test event for owners and admins, and lists recent deliveries', async () => {
    const hook = await addHook()
    const url = `${base()}/webhooks/${hook.id}/test`
    const res = await call('POST', url, ownerCookie)
    expect(res.statusCode).toBe(202)
    const { deliveryId } = res.json()
    const queued = await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, 'webhook'))
    expect(queued.map((j) => j.payload)).toContainEqual(
      expect.objectContaining({
        webhookId: hook?.id,
        deliveryId,
        test: true,
        event: 'webhook.test',
      }),
    )

    expect((await call('POST', url, memberCookie)).statusCode).toBe(403)
    expect((await call('POST', url, rivalCookie)).statusCode).toBe(404)
    expect((await call('POST', `${base()}/webhooks/nope/test`, ownerCookie)).statusCode).toBe(404)
    expect(
      (
        await call(
          'POST',
          `${base()}/webhooks/00000000-0000-0000-0000-000000000000/test`,
          ownerCookie,
        )
      ).statusCode,
    ).toBe(404)

    await recordWebhookDelivery(t.db, {
      webhookId: hook?.id ?? '',
      deliveryId,
      event: 'webhook.test',
      test: true,
      attempt: 1,
      statusCode: 503,
    })
    const listed = (await call('GET', `${base()}/settings`, memberCookie)).json()
    expect(listed.webhooks[0].deliveries).toMatchObject([
      { deliveryId, test: true, attempt: 1, statusCode: 503, error: null },
    ])
    expect(listed.webhooks[0].deliveries[0].createdAt).toMatch(/^\d{4}-/)
  })

  it('deletes a webhook, and answers 404 for a missing or malformed id', async () => {
    const hook = await addHook()
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, ownerCookie)).statusCode).toBe(
      204,
    )
    expect(await listWebhooks(t.db, acme.team.id)).toHaveLength(0)
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, ownerCookie)).statusCode).toBe(
      404,
    )
    expect((await call('DELETE', `${base()}/webhooks/nope`, ownerCookie)).statusCode).toBe(404)
  })
})

const put = (cookie: string, payload: unknown) => call('PUT', `${base()}/github`, cookie, payload)

describe('GitHub link', () => {
  it('links a team to a repository and shows it in the settings', async () => {
    const before = (await call('GET', `${base()}/settings`, memberCookie)).json().github
    expect(before).toEqual({
      configured: true,
      webhookUrl: `${ORIGIN}/webhooks/github`,
      link: null,
    })
    const res = await put(ownerCookie, { installationId: '4242', repoRef: 'acme/web' })
    expect(res.statusCode).toBe(200)
    const after = (await call('GET', `${base()}/settings`, memberCookie)).json().github
    expect(after.link).toEqual({ installationId: '4242', repoRef: 'acme/web', attention: null })
  })

  it('verifies the installation with GitHub, and stores nothing when it cannot', async () => {
    const before = (await call('GET', `${base()}/settings`, memberCookie)).json().github.link
    const unknown = await put(ownerCookie, { installationId: '31337', repoRef: 'acme/web' })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().error).toBe('The GitHub App is not installed with that installation id')
    const down = await put(ownerCookie, { installationId: '9500', repoRef: 'acme/web' })
    expect(down.statusCode).toBe(502)
    expect(down.json().error).toBe('GitHub did not answer; try again shortly')
    expect((await call('GET', `${base()}/settings`, memberCookie)).json().github.link).toEqual(
      before,
    )
    const stored = await t.db.select().from(schema.integrations)
    expect(stored.filter((i) => ['31337', '9500'].includes(i.externalId ?? ''))).toEqual([])
  })

  it('refuses an installation that another workspace already uses (409)', async () => {
    expect(
      (
        await call('PUT', `/api/teams/${rival.workspaceSlug}/web/github`, rivalCookie, {
          installationId: '4244',
          repoRef: 'rival/web',
        })
      ).statusCode,
    ).toBe(200)
    const taken = await put(ownerCookie, { installationId: '4244', repoRef: 'acme/web' })
    expect(taken.statusCode).toBe(409)
    expect(taken.json().error).toBe('That GitHub account is already connected to another workspace')
    expect((await call('GET', `${base()}/settings`, memberCookie)).json().github.link).not.toEqual(
      expect.objectContaining({ installationId: '4244' }),
    )
  })

  it('rejects malformed values, and anyone who is not an owner or admin', async () => {
    const bad = await Promise.all(
      [
        { installationId: 'abc', repoRef: 'acme/web' },
        { installationId: '1', repoRef: 'not a repo' },
        { installationId: '1' },
      ].map(async (b) => (await put(ownerCookie, b)).statusCode),
    )
    expect(bad).toEqual([400, 400, 400])
    expect((await put(memberCookie, { installationId: '1', repoRef: 'a/b' })).statusCode).toBe(403)
    expect((await put(rivalCookie, { installationId: '1', repoRef: 'a/b' })).statusCode).toBe(404)
  })

  it('shows that GitHub refuses the installation, on the settings and the team page, until it is linked again', async () => {
    await put(ownerCookie, { installationId: '4243', repoRef: 'acme/web' })
    const settings = async () =>
      (await call('GET', `${base()}/settings`, memberCookie)).json().github.link.attention
    const page = async () => (await call('GET', base(), memberCookie)).json().gitAttention
    expect(await settings()).toBeNull()
    expect(await page()).toBeNull()

    await markInstallationNeedsAttention(t.db, 'github', '4243', 'installation_revoked')
    expect(await settings()).toEqual({
      reason: 'installation_revoked',
      since: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    })
    expect(await page()).toEqual(await settings())
    // Another workspace's team is not told.
    expect(
      (await call('GET', `/api/teams/${rival.workspaceSlug}/web`, rivalCookie)).json().gitAttention,
    ).toBeNull()

    expect(
      (await put(ownerCookie, { installationId: '4243', repoRef: 'acme/web' })).statusCode,
    ).toBe(200)
    expect(await settings()).toBeNull()
    expect(await page()).toBeNull()
  })

  it('unlinks', async () => {
    expect((await call('DELETE', `${base()}/github`, ownerCookie)).statusCode).toBe(204)
    const after = (await call('GET', `${base()}/settings`, ownerCookie)).json().github
    expect(after.link).toBeNull()
  })
})

const workspaceUrl = () => `/api/workspaces/${acme.workspaceSlug}/settings`

describe('workspace settings', () => {
  it('shows the defaults to members, and whether they can change them', async () => {
    const owner = (await call('GET', workspaceUrl(), ownerCookie)).json()
    expect(owner).toEqual({
      canManage: true,
      settings: { flakyBlocksMerge: true, retentionDays: 30 },
      teams: [{ slug: 'web', name: 'web', flakyBlocksMerge: null }],
    })
    expect((await call('GET', workspaceUrl(), memberCookie)).json().canManage).toBe(false)
  })

  it('lets an owner change them, and teams that inherit see the new value', async () => {
    const res = await call('PATCH', workspaceUrl(), ownerCookie, { flakyBlocksMerge: false })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ settings: { flakyBlocksMerge: false, retentionDays: 30 } })
    expect(await getWorkspaceSettings(t.db, acme.team.workspaceId)).toEqual({
      flakyBlocksMerge: false,
      retentionDays: 30,
    })
    const team = (await call('GET', `${base()}/settings`, memberCookie)).json()
    expect(team.workspace).toEqual({ flakyBlocksMerge: false, retentionDays: 30 })
    expect(team.settings.flakyBlocksMerge).toBeNull()
  })

  it('rejects invalid values and unknown fields', async () => {
    const codes = await Promise.all(
      [{ flakyBlocksMerge: 'yes' }, { flakyBlocksMerge: null }, { other: true }].map(
        async (body) => (await call('PATCH', workspaceUrl(), ownerCookie, body)).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400])
  })

  it('refuses plain members with 403 and outsiders with 404', async () => {
    await call('PATCH', workspaceUrl(), ownerCookie, { flakyBlocksMerge: false })
    expect(
      (await call('PATCH', workspaceUrl(), memberCookie, { flakyBlocksMerge: true })).statusCode,
    ).toBe(403)
    expect((await call('GET', workspaceUrl(), rivalCookie)).statusCode).toBe(404)
    expect(
      (await call('PATCH', workspaceUrl(), rivalCookie, { flakyBlocksMerge: true })).statusCode,
    ).toBe(404)
    expect(await getWorkspaceSettings(t.db, acme.team.workspaceId)).toEqual({
      flakyBlocksMerge: false,
      retentionDays: 30,
    })
  })
})
