import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret, signState } from '@circi/core'
import {
  createIntegration,
  getIntegration,
  getOrganizationBySlug,
  listIntegrations,
  listIntegrationProjects,
  setIntegrationAttention,
} from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const SECRET = 'a-long-instance-secret-for-tests-0123456789'

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-slack-'))
const auth = createTestAuth(t.db)

/** Slack's HTTP edge: one workspace behind the code `good`, one channel list, tokens can die. */
let revoked = false
const fetcher: typeof fetch = async (input, init) => {
  const req = new Request(input, init)
  const method = new URL(req.url).pathname.split('/').at(-1)
  const form = new URLSearchParams(await req.text())
  if (method === 'oauth.v2.access') {
    return form.get('code') === 'good'
      ? Response.json({
          ok: true,
          access_token: 'xoxb-installed',
          bot_user_id: 'U1',
          team: { id: 'T42', name: 'Acme Workspace' },
        })
      : Response.json({ ok: false, error: 'invalid_code' })
  }
  if (method === 'conversations.list') {
    if (revoked) return Response.json({ ok: false, error: 'token_revoked' })
    return req.headers.get('authorization') === 'Bearer xoxb-installed'
      ? Response.json({
          ok: true,
          channels: [
            { id: 'C02WEB1', name: 'web-reviews', is_private: false },
            { id: 'G01DSGN', name: 'design', is_private: true },
          ],
        })
      : Response.json({ ok: false, error: 'invalid_auth' })
  }
  return Response.json({ ok: false, error: 'unknown_method' })
}

const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: SECRET,
    integrations: {
      config: {
        slack: { clientId: 'cid', clientSecret: 'csecret', apiUrl: 'https://slack.test/api' },
      },
      fetch: fetcher,
    },
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
  email: 'lou-slack@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, t.db, { orgSlug: acme.orgSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')
const org = await getOrganizationBySlug(t.db, acme.orgSlug)

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      origin: ORIGIN,
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  })

const orgBase = `/api/orgs/${acme.orgSlug}/integrations`
const base = `${orgBase}/slack`
const callback = (query: string, cookie = ownerCookie) =>
  call('GET', `/api/integrations/slack/callback?${query}`, cookie)
const stateFor = (claims: Record<string, string>, options?: { now?: number; ttlMs?: number }) =>
  signState(SECRET, claims, options)
const goodClaims = { kind: 'slack', orgId: org.id, orgSlug: acme.orgSlug, userId: acme.owner.id }

describe('the catalog', () => {
  it('offers Slack as connectable when the server has the Slack app configured', async () => {
    const res = await call('GET', `/api/orgs/${acme.orgSlug}/integrations`, ownerCookie)
    const slack = res.json().catalog.find((e: { kind: string }) => e.kind === 'slack')
    expect(slack).toMatchObject({ built: true, connectable: true })
  })
})

describe('GET .../slack/install', () => {
  it('needs a session, membership and an owner or admin', async () => {
    expect((await call('GET', `${base}/install`, '')).statusCode).toBe(401)
    expect((await call('GET', `${base}/install`, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', `${base}/install`, louCookie)).statusCode).toBe(403)
  })

  it('returns the authorize url with a signed state binding the org and the user', async () => {
    const res = await call('GET', `${base}/install`, ownerCookie)
    expect(res.statusCode).toBe(200)
    const url = new URL(res.json().url)
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/integrations/slack/callback`)
    const state = url.searchParams.get('state') ?? ''
    const [payload] = state.split('.')
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toMatchObject({
      orgId: org.id,
      userId: acme.owner.id,
    })
    // The callback accepts it as is (the Slack side is the fake).
    expect((await callback(`code=good&state=${encodeURIComponent(state)}`)).statusCode).toBe(302)
  })
})

describe('GET /api/integrations/slack/callback', () => {
  it('stores the workspace with its bot token sealed, then goes to its page', async () => {
    const res = await callback(`code=good&state=${encodeURIComponent(stateFor(goodClaims))}`)
    expect(res.statusCode).toBe(302)
    const row = (await listIntegrations(t.db, org.id)).find((i) => i.kind === 'slack')
    expect(res.headers.location).toBe(
      `/organizations/${acme.orgSlug}/settings/integrations/slack/${row?.id}?connect=connected`,
    )
    expect(row).toMatchObject({ displayName: 'Acme Workspace', needsAttention: false })
    const stored = await getIntegration(t.db, org.id, row?.id ?? '')
    expect(stored?.externalId).toBe('T42')
    expect(stored?.encryptedCredentials).not.toContain('xoxb-installed')
    expect(openSecret(SECRET, stored?.encryptedCredentials ?? '')).toBe('xoxb-installed')
    expect(stored?.createdBy).toBe(acme.owner.id)
  })

  it('reinstalling the same workspace replaces the token and clears needs-attention', async () => {
    const row = (await listIntegrations(t.db, org.id)).find((i) => i.kind === 'slack')
    await setIntegrationAttention(t.db, row?.id ?? '', 'token_revoked')
    await callback(`code=good&state=${encodeURIComponent(stateFor(goodClaims))}`)
    const slack = (await listIntegrations(t.db, org.id)).filter((i) => i.kind === 'slack')
    expect(slack).toHaveLength(1)
    expect(slack[0]).toMatchObject({ needsAttention: false })
  })

  it('refuses a missing, forged, expired or foreign state and stores nothing new', async () => {
    const before = (await listIntegrations(t.db, org.id)).length
    const bad = [
      '',
      'code=good',
      `code=good&state=${encodeURIComponent('forged.state')}`,
      `code=good&state=${encodeURIComponent(stateFor(goodClaims, { now: Date.now() - 3_600_000 }))}`,
      `code=good&state=${encodeURIComponent(signState('another-secret-another-secret-123456', goodClaims))}`,
      // A state issued to someone else cannot be used by this session.
      `code=good&state=${encodeURIComponent(stateFor({ ...goodClaims, userId: lou.id }))}`,
    ]
    for (const query of bad) {
      // eslint-disable-next-line no-await-in-loop -- each case on its own
      const res = await callback(query)
      expect(`${query} -> ${res.statusCode}`).toBe(`${query} -> 400`)
    }
    expect((await listIntegrations(t.db, org.id)).length).toBe(before)
  })

  it('needs a session, and a state for an organisation the user still manages', async () => {
    const state = encodeURIComponent(stateFor(goodClaims))
    expect((await callback(`code=good&state=${state}`, '')).statusCode).toBe(401)
    // Lou is a plain member: even with a state issued to him, he cannot connect.
    const lous = encodeURIComponent(stateFor({ ...goodClaims, userId: lou.id }))
    expect((await callback(`code=good&state=${lous}`, louCookie)).statusCode).toBe(403)
  })

  it('goes back with denied/failed instead of storing anything', async () => {
    const state = encodeURIComponent(stateFor(goodClaims))
    const denied = await callback(`error=access_denied&state=${state}`)
    expect(denied.headers.location).toBe(
      `/organizations/${acme.orgSlug}/settings/integrations?connect=denied&kind=slack`,
    )
    const failed = await callback(`code=bad&state=${state}`)
    expect(failed.statusCode).toBe(302)
    expect(failed.headers.location).toContain('connect=failed')
  })
})

const integrationId = async () =>
  (await listIntegrations(t.db, org.id)).find((i) => i.kind === 'slack')?.id ?? ''

describe('the mapping page, targets and project mapping', () => {
  it('lists the integration with its definition and every project, for every member', async () => {
    const id = await integrationId()
    for (const [cookie, manage] of [
      [ownerCookie, true],
      [louCookie, false],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- two viewers
      const res = await call('GET', `${orgBase}/${id}/projects`, cookie)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        canManage: manage,
        configured: true,
        integration: { id, kind: 'slack', name: 'Acme Workspace', needsAttention: false },
        definition: {
          kind: 'slack',
          oauth: true,
          credentials: [],
          mapping: { targetKind: 'select', fields: [{ kind: 'events', key: 'events' }] },
        },
        projects: [{ slug: 'web', mapping: null }],
      })
    }
    expect((await call('GET', `${orgBase}/${id}/projects`, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', `${orgBase}/${id}/projects`, '')).statusCode).toBe(401)
  })

  it('lists the targets for admins only', async () => {
    const id = await integrationId()
    expect((await call('GET', `${orgBase}/${id}/targets`, louCookie)).statusCode).toBe(403)
    expect((await call('GET', `${orgBase}/${id}/targets`, rivalCookie)).statusCode).toBe(404)
    const res = await call('GET', `${orgBase}/${id}/targets`, ownerCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().targets).toEqual([
      { id: 'G01DSGN', name: 'design', label: 'design (private)' },
      { id: 'C02WEB1', name: 'web-reviews', label: '#web-reviews' },
    ])
  })

  it('maps a project to a channel with events, replaces it, and clears it', async () => {
    const id = await integrationId()
    const url = `${orgBase}/${id}/projects/web`
    const body = {
      ref: 'C02WEB1',
      name: 'web-reviews',
      extra: { events: ['build.rejected', 'review.requested'] },
    }
    expect((await call('PUT', url, louCookie, body)).statusCode).toBe(403)
    expect((await call('PUT', url, rivalCookie, body)).statusCode).toBe(404)
    expect((await call('PUT', url, ownerCookie, { ...body, ref: 'nope' })).statusCode).toBe(400)
    expect((await call('PUT', url, ownerCookie, { ref: 'C02WEB1' })).statusCode).toBe(400)
    expect(
      (await call('PUT', url, ownerCookie, { ...body, extra: { events: ['spam'] } })).statusCode,
    ).toBe(400)
    expect(
      (await call('PUT', url, ownerCookie, { ...body, extra: { other: true } })).statusCode,
    ).toBe(400)
    expect(
      (await call('PUT', `${orgBase}/${id}/projects/ghost`, ownerCookie, body)).statusCode,
    ).toBe(404)
    expect((await call('PUT', url, ownerCookie, body)).statusCode).toBe(204)
    expect(await listIntegrationProjects(t.db, id)).toMatchObject([
      {
        slug: 'web',
        externalRef: 'C02WEB1',
        extra: { name: 'web-reviews', events: ['review.requested', 'build.rejected'] },
      },
    ])
    const page = (await call('GET', `${orgBase}/${id}/projects`, louCookie)).json()
    expect(page.projects[0].mapping).toEqual({
      ref: 'C02WEB1',
      name: 'web-reviews',
      extra: { name: 'web-reviews', events: ['review.requested', 'build.rejected'] },
    })
    // Without settings the definition's defaults apply; the channel is replaced.
    await call('PUT', url, ownerCookie, { ref: 'G01DSGN', name: 'design' })
    expect(await listIntegrationProjects(t.db, id)).toMatchObject([
      {
        externalRef: 'G01DSGN',
        extra: { events: ['review.requested', 'review.overdue', 'build.rejected'] },
      },
    ])
    expect((await call('DELETE', url, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    expect(await listIntegrationProjects(t.db, id)).toEqual([])
  })

  it('flags the workspace when Slack says the token is gone', async () => {
    const id = await integrationId()
    revoked = true
    const res = await call('GET', `${orgBase}/${id}/targets`, ownerCookie)
    revoked = false
    expect(res.statusCode).toBe(409)
    const row = (await listIntegrations(t.db, org.id)).find((i) => i.kind === 'slack')
    expect(row).toMatchObject({ needsAttention: true })
    expect(row?.needsAttentionReason).toContain('token_revoked')
  })

  it('does not touch another organisation’s integration', async () => {
    const other = await createIntegration(t.db, {
      orgId: (await getOrganizationBySlug(t.db, rival.orgSlug)).id,
      kind: 'slack',
      displayName: 'Rival',
      externalId: 'T99',
    })
    expect((await call('GET', `${orgBase}/${other.id}/targets`, ownerCookie)).statusCode).toBe(404)
    expect((await call('GET', `${orgBase}/${other.id}/projects`, ownerCookie)).statusCode).toBe(404)
    const put = await call('PUT', `${orgBase}/${other.id}/projects/web`, ownerCookie, {
      ref: 'C02WEB1',
      name: 'x',
    })
    expect(put.statusCode).toBe(404)
  })

  it('answers 404 for an integration whose kind is not in the registry', async () => {
    const unknown = await createIntegration(t.db, {
      orgId: org.id,
      kind: 'not-registered',
      displayName: 'Ghost',
      externalId: 'g1',
    })
    expect((await call('GET', `${orgBase}/${unknown.id}/projects`, ownerCookie)).statusCode).toBe(
      404,
    )
  })
})

describe('connecting with a form', () => {
  it('refuses a kind that is not registered, and an OAuth-only one', async () => {
    expect((await call('POST', `${orgBase}/nope/connect`, ownerCookie, {})).statusCode).toBe(404)
    expect((await call('POST', `${base}/connect`, ownerCookie, {})).statusCode).toBe(400)
  })
})
