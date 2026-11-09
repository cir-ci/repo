import { createHmac, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { signState, verifyState } from '@circi/core'
import { getSetting, listIntegrations } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import type { IntegrationDefinition } from '@circi/integrations'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { readStoredGithubApp, useStoredGithubApp } from '#composition/github-app.ts'
import { buildServer } from '#http/app.ts'
import { clientFor } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

/**
 * The GitHub App manifest flow. GitHub is never contacted: its conversion endpoint, the App's
 * installation tokens and the repository listing are a fake `fetch` at the HTTP edge.
 */

const SECRET = 'instance-secret-long-enough-for-test'
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-github-app-'))
const auth = createTestAuth(t.db)

const requests: string[] = []
const usedCodes = new Set<string>()
/** Installations that exist on the fake GitHub. */
const INSTALLED = new Set(['501', '502', '503'])
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const githubFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  )
  const method = init?.method ?? 'GET'
  requests.push(`${method} ${url.pathname}`)
  let m: RegExpExecArray | null
  if ((m = /^\/app-manifests\/([^/]+)\/conversions$/.exec(url.pathname)) && method === 'POST') {
    const code = m[1] ?? ''
    if (code !== 'good-code' && code !== 'second-code') return json({ message: 'Not Found' }, 404)
    if (usedCodes.has(code)) return json({ message: 'Not Found' }, 404)
    usedCodes.add(code)
    return json(
      {
        id: 4242,
        slug: 'circi-ci-acme-io',
        client_id: 'Iv1.client',
        client_secret: 'client-secret-value',
        webhook_secret: 'whsec-from-github',
        pem: privateKey,
        html_url: 'https://github.com/apps/circi-ci-acme-io',
      },
      201,
    )
  }
  if ((m = /^\/app\/installations\/([^/]+)\/access_tokens$/.exec(url.pathname))) {
    if (!INSTALLED.has(m[1] ?? '')) return json({ message: 'Not Found' }, 404)
    return json(
      { token: 'ghs_fake', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
      201,
    )
  }
  if (url.pathname === '/installation/repositories') {
    return json({ repositories: [{ full_name: 'acme/web' }] })
  }
  if (url.pathname === '/app') {
    return json({ slug: 'env-app', name: 'Env App', html_url: 'https://github.com/apps/env-app' })
  }
  return json({ message: 'unscripted' }, 500)
}

/** The live configuration, shared by the dashboard and the webhook as in production. */
const config: IntegrationDefinition.InstanceConfig = {}
const app: FastifyInstance = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  gitWebhook: {
    db: t.db,
    authSecret: SECRET,
    publicOrigin: ORIGIN,
    integrations: { config, fetch: githubFetch },
    logger: pino({ level: 'silent' }),
  },
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: SECRET,
    integrations: { config, fetch: githubFetch },
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
const admin = await createUser(auth, {
  email: 'instance-admin@acme.test',
  name: 'Instance admin',
  password: 'admin-password-long-1',
})
await t.db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, admin.id))
const member = await createUser(auth, {
  email: 'member@acme.test',
  name: 'Member',
  password: 'member-password-long-1',
})
await addMember(auth, t.db, {
  workspaceSlug: acme.workspaceSlug,
  email: member.email,
  role: 'member',
})
const adminCookie = await signIn(app, 'instance-admin@acme.test', 'admin-password-long-1')
const memberCookie = await signIn(app, member.email, 'member-password-long-1')
const ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
// The instance admin administers a workspace of their own (installation owner for the 409 test).
await addMember(auth, t.db, {
  workspaceSlug: acme.workspaceSlug,
  email: admin.email,
  role: 'owner',
})

const get = (url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

const serverAt = async (publicOrigin: string) => {
  const other = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: dir }),
      publicOrigin,
      authSecret: SECRET,
      integrations: { config: {}, fetch: githubFetch },
    },
  })
  await other.ready()
  return other
}

const callback = (state: string, code = 'good-code', cookie = adminCookie) =>
  get(`/api/instance/github-app/callback?code=${code}&state=${encodeURIComponent(state)}`, cookie)
const manifestState = (userId: string, options?: { now?: number; ttlMs?: number }) =>
  signState(SECRET, { kind: 'github-manifest', userId }, options)

const installState = async (cookie: string, workspace: string) => {
  const res = await get(`/api/workspaces/${workspace}/integrations/github/install`, cookie)
  expect(res.statusCode).toBe(200)
  const url = new URL(String(res.json().url))
  expect(`${url.origin}${url.pathname}`).toBe(
    'https://github.com/apps/circi-ci-acme-io/installations/new',
  )
  return url.searchParams.get('state') ?? ''
}
const setup = (query: string, cookie: string) =>
  get(`/api/integrations/github/setup?${query}`, cookie)

const stateOf = (location: string | undefined) =>
  new URL(location ?? '', 'https://x.test').searchParams.get('state') ?? ''

const resetDb = await snapshotDb(t)
beforeEach(async () => {
  await resetDb()
  // The live configuration, the fake GitHub's memory: back to "no App yet, nothing asked".
  delete config.github
  usedCodes.clear()
  requests.length = 0
})

/** Has the instance admin create the App through the manifest callback, as the dashboard does. */
async function installApp() {
  expect((await callback(manifestState(admin.id))).statusCode).toBe(302)
}

describe('the manifest', () => {
  it('has exactly the permissions, events and addresses the App needs', async () => {
    const res = await clientFor(app, adminCookie).send(
      'POST',
      '/api/instance/github-app/manifest',
      {},
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.manifest).toEqual({
      name: 'CirCI (ci.acme.io)',
      url: 'https://ci.acme.io',
      hook_attributes: { url: 'https://ci.acme.io/api/integrations/github/webhook', active: true },
      redirect_url: 'https://ci.acme.io/api/instance/github-app/callback',
      setup_url: 'https://ci.acme.io/api/integrations/github/setup',
      setup_on_update: true,
      public: false,
      default_permissions: { checks: 'write', pull_requests: 'write', metadata: 'read' },
      default_events: ['check_run', 'issue_comment', 'pull_request'],
    })
    expect(body.postUrl).toBe('https://github.com/settings/apps/new')
    expect(verifyState(SECRET, body.state)).toEqual({ kind: 'github-manifest', userId: admin.id })
  })

  it('takes an editable name and posts to a GitHub organization when one is named', async () => {
    const res = await clientFor(app, adminCookie).send(
      'POST',
      '/api/instance/github-app/manifest',
      {
        name: 'CirCI at Acme',
        organization: 'acme-inc',
      },
    )
    expect(res.json().manifest.name).toBe('CirCI at Acme')
    expect(res.json().postUrl).toBe('https://github.com/organizations/acme-inc/settings/apps/new')
    const bad = await clientFor(app, adminCookie).send(
      'POST',
      '/api/instance/github-app/manifest',
      {
        organization: 'not/valid',
      },
    )
    expect(bad.statusCode).toBe(400)
  })

  it('is for instance admins only', async () => {
    expect(
      (await clientFor(app, ownerCookie).send('POST', '/api/instance/github-app/manifest', {}))
        .statusCode,
    ).toBe(403)
    expect((await get('/api/instance/github-app')).statusCode).toBe(401)
    expect((await get('/api/instance/github-app', ownerCookie)).json()).toMatchObject({
      source: 'none',
      canManage: false,
    })
  })

  it('refuses a plain-http address that is not local, and warns about localhost', async () => {
    const insecure = await serverAt('http://ci.acme.io')
    const refused = await insecure.inject({
      method: 'POST',
      url: '/api/instance/github-app/manifest',
      headers: {
        origin: 'http://ci.acme.io',
        'content-type': 'application/json',
        cookie: adminCookie,
      },
      payload: '{}',
    })
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error).toMatch(/https/)
    await insecure.close()

    const local = await serverAt('http://localhost:3000')
    const status = await local.inject({
      method: 'GET',
      url: '/api/instance/github-app',
      headers: { cookie: adminCookie },
    })
    expect(status.json().warning).toMatch(/cannot deliver webhooks/)
    expect(status.json().blocked).toBeNull()
    await local.close()
  })
})

describe('the callback', () => {
  it('rejects a forged, expired, foreign or wrong-kind state', async () => {
    const good = manifestState(admin.id)
    const [payload = ''] = good.split('.')
    expect((await callback(`${payload}.AAAA`)).statusCode).toBe(400)
    expect((await callback('nonsense')).statusCode).toBe(400)
    const expired = manifestState(admin.id, { now: Date.now() - 3_600_000, ttlMs: 1000 })
    expect((await callback(expired)).statusCode).toBe(400)
    // Issued to someone else, or for another flow.
    expect((await callback(manifestState(rival.owner.id))).statusCode).toBe(400)
    expect(
      (await callback(signState(SECRET, { kind: 'github', userId: admin.id }))).statusCode,
    ).toBe(400)
    // A valid state still needs the instance admin.
    const asOwner = await callback(manifestState(acme.owner.id), 'good-code', ownerCookie)
    expect(asOwner.statusCode).toBe(403)
    expect(usedCodes.size).toBe(0)
    expect((await get('/api/instance/github-app/callback?code=x&state=y')).statusCode).toBe(401)
  })

  it('stores the App sealed, uses it at once without a restart, and takes a code only once', async () => {
    // Before: nothing configured, the webhook has no provider and GitHub is not connectable.
    const body = '{}'
    const signed = (secret: string) =>
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    const deliver = (secret: string, id: string) =>
      app.inject({
        method: 'POST',
        url: '/api/integrations/github/webhook',
        headers: {
          'content-type': 'application/json',
          'x-github-delivery': id,
          'x-github-event': 'ping',
          'x-hub-signature-256': signed(secret),
        },
        payload: body,
      })
    expect((await deliver('whsec-from-github', 'd0')).statusCode).toBe(404)
    const before = (
      await get(`/api/workspaces/${acme.workspaceSlug}/integrations`, ownerCookie)
    ).json()
    expect(before.catalog.find((e: { kind: string }) => e.kind === 'github').connectable).toBe(
      false,
    )

    const res = await callback(manifestState(admin.id))
    expect(res.statusCode).toBe(302)
    const location = new URL(res.headers.location ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://github.com/apps/circi-ci-acme-io/installations/new',
    )
    expect(verifyState(SECRET, stateOf(res.headers.location ?? ''))).toEqual({
      kind: 'github',
      flow: 'install',
      userId: admin.id,
    })

    // Stored, with the secrets sealed.
    const raw = (await getSetting(t.db, 'github_app')) ?? ''
    for (const secret of [privateKey, 'whsec-from-github', 'client-secret-value']) {
      expect(raw).not.toContain(secret.trim())
    }
    expect(await readStoredGithubApp(t.db, SECRET)).toMatchObject({
      appId: '4242',
      slug: 'circi-ci-acme-io',
      clientId: 'Iv1.client',
      clientSecret: 'client-secret-value',
      webhookSecret: 'whsec-from-github',
      privateKey,
      apiUrl: 'https://api.github.com',
    })
    expect(await readStoredGithubApp(t.db, 'another-secret-entirely')).toBeUndefined()

    // After: usable without a restart.
    const after = (
      await get(`/api/workspaces/${acme.workspaceSlug}/integrations`, ownerCookie)
    ).json()
    expect(after.catalog.find((e: { kind: string }) => e.kind === 'github').connectable).toBe(true)
    expect((await deliver('wrong-secret', 'd1')).statusCode).toBe(401)
    expect((await deliver('whsec-from-github', 'd2')).statusCode).toBe(200)

    // The dashboard sees where it came from, never a secret.
    const status = await get('/api/instance/github-app', adminCookie)
    expect(status.json()).toMatchObject({
      source: 'manifest',
      canManage: true,
      appId: '4242',
      slug: 'circi-ci-acme-io',
      htmlUrl: 'https://github.com/apps/circi-ci-acme-io',
    })
    expect(status.body).not.toContain('whsec-from-github')
    expect(status.body).not.toContain('PRIVATE KEY')

    // A code works once: the second try fails gracefully and keeps the stored App.
    const again = await callback(manifestState(admin.id))
    expect(again.statusCode).toBe(302)
    expect(again.headers.location).toBe('/instance?githubApp=failed')
    expect((await readStoredGithubApp(t.db, SECRET))?.appId).toBe('4242')

    // A restart finds it in the database.
    const restarted: IntegrationDefinition.InstanceConfig = {}
    expect(await useStoredGithubApp(t.db, SECRET, restarted)).toBe(true)
    expect(restarted.github).toMatchObject({ appId: '4242', webhookSecret: 'whsec-from-github' })
  })
})

describe('installing the App in a workspace', () => {
  it('names the workspace in a signed state, for owners and admins only', async () => {
    await installApp()
    const state = await installState(ownerCookie, acme.workspaceSlug)
    expect(verifyState(SECRET, state)).toMatchObject({
      kind: 'github',
      flow: 'install',
      userId: acme.owner.id,
      workspaceSlug: acme.workspaceSlug,
    })
    expect(
      (await get(`/api/workspaces/${acme.workspaceSlug}/integrations/github/install`, memberCookie))
        .statusCode,
    ).toBe(403)
  })

  it('connects the installation to that workspace, through the same checks as the manual form', async () => {
    await installApp()
    const state = await installState(ownerCookie, acme.workspaceSlug)
    const res = await setup(
      `installation_id=501&setup_action=install&state=${encodeURIComponent(state)}`,
      ownerCookie,
    )
    expect(res.statusCode).toBe(302)
    const connected = (await listIntegrations(t.db, await workspaceId(acme.workspaceSlug))).find(
      (i) => i.kind === 'github',
    )
    expect(connected).toMatchObject({ displayName: 'Installation 501' })
    expect(res.headers.location).toBe(
      `/workspaces/${acme.workspaceSlug}/settings/integrations/github/${connected?.id}?connect=connected`,
    )
    // GitHub is asked for a token and the repositories: the App must really be installed.
    expect(requests).toContain('POST /app/installations/501/access_tokens')
    expect(requests).toContain('GET /installation/repositories')
    // Coming back again (the App's settings, "update") replaces rather than conflicts.
    const again = await setup(
      `installation_id=501&setup_action=update&state=${encodeURIComponent(state)}`,
      ownerCookie,
    )
    expect(again.statusCode).toBe(302)
  })

  it('refuses an installation another workspace uses (409), one GitHub does not have (404) and a non-admin (403)', async () => {
    await installApp()
    // Acme connects installation 501 first.
    const acmeState = await installState(ownerCookie, acme.workspaceSlug)
    expect(
      (await setup(`installation_id=501&state=${encodeURIComponent(acmeState)}`, ownerCookie))
        .statusCode,
    ).toBe(302)
    const rivalState = signState(SECRET, {
      kind: 'github',
      flow: 'install',
      userId: rival.owner.id,
      workspaceId: await workspaceId(rival.workspaceSlug),
      workspaceSlug: rival.workspaceSlug,
    })
    const taken = await setup(
      `installation_id=501&state=${encodeURIComponent(rivalState)}`,
      rivalCookie,
    )
    expect(taken.statusCode).toBe(409)

    const state = await installState(ownerCookie, acme.workspaceSlug)
    const missing = await setup(
      `installation_id=999&state=${encodeURIComponent(state)}`,
      ownerCookie,
    )
    expect(missing.statusCode).toBe(404)

    const memberState = signState(SECRET, {
      kind: 'github',
      flow: 'install',
      userId: member.id,
      workspaceId: await workspaceId(acme.workspaceSlug),
      workspaceSlug: acme.workspaceSlug,
    })
    const denied = await setup(
      `installation_id=502&state=${encodeURIComponent(memberState)}`,
      memberCookie,
    )
    expect(denied.statusCode).toBe(403)
  })

  it('rejects a forged, expired or someone else’s state, and needs a session', async () => {
    await installApp()
    const state = await installState(ownerCookie, acme.workspaceSlug)
    expect((await setup(`installation_id=502&state=${state}x`, ownerCookie)).statusCode).toBe(400)
    // Started by the owner, followed by another signed-in user.
    expect(
      (await setup(`installation_id=502&state=${encodeURIComponent(state)}`, rivalCookie))
        .statusCode,
    ).toBe(400)
    const expired = signState(
      SECRET,
      { kind: 'github', flow: 'install', userId: acme.owner.id },
      { now: Date.now() - 3_600_000, ttlMs: 1 },
    )
    expect(
      (await setup(`installation_id=502&state=${encodeURIComponent(expired)}`, ownerCookie))
        .statusCode,
    ).toBe(400)
    // The manifest state is not an install state.
    const wrong = signState(SECRET, { kind: 'github-manifest', userId: acme.owner.id })
    expect(
      (await setup(`installation_id=502&state=${encodeURIComponent(wrong)}`, ownerCookie))
        .statusCode,
    ).toBe(400)
    expect((await setup('installation_id=502', '')).statusCode).toBe(401)
  })

  it('sends an install made on GitHub itself (no state) to the page where the workspace is picked', async () => {
    const res = await setup('installation_id=503&setup_action=install', ownerCookie)
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe(
      '/integrations/github/setup?installation_id=503&setup_action=install',
    )
    expect((await setup('setup_action=request', ownerCookie)).headers.location).toBe('/')
  })
})

describe('an App from the environment', () => {
  it('takes precedence: shown read-only, and the manifest flow is closed', async () => {
    const envConfig: IntegrationDefinition.InstanceConfig = {
      github: {
        apiUrl: 'https://api.github.com',
        appId: '7',
        privateKey,
        webhookSecret: 'env-secret',
      },
    }
    const envApp = buildServer({
      logger: pino({ level: 'silent' }),
      checks: [],
      dashboard: {
        db: t.db,
        auth,
        storage: new FsStorage({ path: dir }),
        publicOrigin: ORIGIN,
        authSecret: SECRET,
        githubApp: true,
        integrations: { config: envConfig, fetch: githubFetch },
      },
    })
    await envApp.ready()
    const status = await envApp.inject({
      method: 'GET',
      url: '/api/instance/github-app',
      headers: { cookie: adminCookie },
    })
    expect(status.json()).toMatchObject({
      source: 'env',
      appId: '7',
      slug: 'env-app',
      htmlUrl: 'https://github.com/apps/env-app',
    })
    expect(status.body).not.toContain('env-secret')
    const manifest = await envApp.inject({
      method: 'POST',
      url: '/api/instance/github-app/manifest',
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: adminCookie },
      payload: '{}',
    })
    expect(manifest.statusCode).toBe(409)
    const state = signState(SECRET, { kind: 'github-manifest', userId: admin.id })
    const returned = await envApp.inject({
      method: 'GET',
      url: `/api/instance/github-app/callback?code=second-code&state=${encodeURIComponent(state)}`,
      headers: { cookie: adminCookie },
    })
    expect(returned.statusCode).toBe(409)
    expect(usedCodes.has('second-code')).toBe(false)
    expect(envConfig.github?.appId).toBe('7')
    await envApp.close()
  })
})

async function workspaceId(slug: string): Promise<string> {
  const [row] = await t.db
    .select({ id: schema.workspace.id })
    .from(schema.workspace)
    .where(eq(schema.workspace.slug, slug))
  return row?.id ?? ''
}
