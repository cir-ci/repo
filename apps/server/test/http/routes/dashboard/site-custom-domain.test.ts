import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Auth, createUser } from '@circi/auth'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import type { SiteDnsResolver } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import * as tar from 'tar'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import {
  createTestAuth,
  seedTenant,
  signIn,
  type Tenant,
  addMember as addWorkspaceMember,
} from '#test/support/helpers.ts'

/**
 * A site's custom domain: setting and verifying it in the dashboard API, Caddy's TLS ask, and
 * serving the default branch on it with the sign-in handoff. DNS is faked (a mutable zone the
 * test edits): real DNS, certificates and Caddy have not been exercised here.
 */

const DASH = 'https://ci.acme.io'
const SITES = 'example-sites.com'
const DOMAIN = 'storybook.acme.com'
const originFor = (address: string) =>
  `https://${address.includes('.') ? address : `${address}.${SITES}`}`
const MAIN1 = 'a'.repeat(40)
const MAIN2 = 'b'.repeat(40)
const FEATURE = 'c'.repeat(40)

const zone: { cname: Record<string, string>; a: Record<string, string[]> } = { cname: {}, a: {} }
const resolveDns: SiteDnsResolver = {
  cname: async (host) => (zone.cname[host] ? [zone.cname[host]] : []),
  address: async (host) => zone.a[host] ?? [],
}
const pointAtServer = () => {
  zone.cname[DOMAIN] = `custom.${SITES}`
}

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let auth: Auth
let acme: Tenant
let rival: Tenant
let ownerCookie: string
let rivalCookie: string
let memberCookie: string
let slug = ''

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-domain-'))
  auth = createTestAuth(t.db)
  const storage = new FsStorage({ path: join(dir, 'files') })
  const sites = { host: SITES, maxBytes: 5 * 1024 * 1024, originFor }
  app = buildServer({
    logger: pino({ level: process.env.TEST_LOG ?? 'silent' }),
    checks: [],
    siteServing: {
      db: t.db,
      storage,
      publicOrigin: DASH,
      sites,
      secret: 'test-secret-that-is-long-enough-1234',
      revalidateMs: 0,
    },
    tlsAsk: { db: t.db, maxPerMinute: 1000 },
    api: { db: t.db, auth, storage, publicOrigin: DASH, sites },
    dashboard: { db: t.db, auth, storage, publicOrigin: DASH, sites, resolveDns },
  })
  await app.ready()
  acme = await seedTenant(auth, t.db)
  rival = await seedTenant(auth, t.db)
  await t.db
    .update(schema.teams)
    .set({ staticHostingEnabled: true })
    .where(eq(schema.teams.id, acme.team.id))
  await t.db
    .update(schema.teams)
    .set({ staticHostingEnabled: true })
    .where(eq(schema.teams.id, rival.team.id))
  ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
  const member = { email: 'plain-member@acme.test', password: 'plain-member-password-long' }
  await createUser(auth, { ...member, name: 'Plain member' })
  await addWorkspaceMember(auth, t.db, {
    workspaceSlug: acme.workspaceSlug,
    email: member.email,
    role: 'member',
  })
  memberCookie = await signIn(app, member.email, member.password)
  slug = (await upload(MAIN1, 'main', 'v1', acme.token)).json().site.slug
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

async function pack(html: string) {
  const root = await mkdtemp(join(dir, 'site-'))
  const files: Record<string, string> = {
    'index.html': html,
    'iframe.html': 'i',
    'index.json': '{"entries":{}}',
  }
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), content)
    }),
  )
  const chunks: Buffer[] = []
  for await (const chunk of tar.create({ gzip: true, cwd: root }, ['.'])) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function upload(
  commit: string,
  branch: string,
  html: string,
  token: string,
  name = 'storybook',
) {
  const qs = new URLSearchParams({ commit, branch, branch_tip: commit, name, kind: 'storybook' })
  return app.inject({
    method: 'POST',
    url: `/v1/sites?${qs.toString()}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip' },
    payload: await pack(html),
  })
}

const api = (
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  cookie: string,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/teams/${acme.workspaceSlug}/web/sites${path}`,
    headers: { cookie, origin: DASH, ...(payload ? { 'content-type': 'application/json' } : {}) },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  })
const domainPath = () => `/${slug}/domain`

const listed = async () =>
  (await api('GET', '', ownerCookie)).json().sites.find((s: { slug: string }) => s.slug === slug)

describe('setting a custom domain in the dashboard API', () => {
  it('lets an owner set, check and remove it, and lists it with the DNS target', async () => {
    const set = await api('PUT', domainPath(), ownerCookie, { domain: ' Storybook.ACME.com ' })
    expect(set.statusCode).toBe(200)
    expect(set.json()).toEqual({
      domain: DOMAIN,
      verified: false,
      verifiedAt: null,
      address: `https://${DOMAIN}`,
    })
    const list = (await api('GET', '', ownerCookie)).json()
    expect(list.dnsTarget).toBe(`custom.${SITES}`)
    expect(list.canManage).toBe(true)
    expect((await listed()).customDomain).toMatchObject({ domain: DOMAIN, verified: false })

    zone.cname = {}
    const missing = await api('POST', `${domainPath()}/verify`, ownerCookie, {})
    expect(missing.json()).toMatchObject({
      verified: false,
      error: expect.stringContaining('CNAME'),
    })
    pointAtServer()
    const ok = await api('POST', `${domainPath()}/verify`, ownerCookie, {})
    expect(ok.json()).toMatchObject({ domain: DOMAIN, verified: true, error: null })
    expect((await listed()).customDomain).toMatchObject({ verified: true })

    expect((await api('DELETE', domainPath(), ownerCookie)).statusCode).toBe(204)
    expect((await listed()).customDomain).toBeNull()
    expect((await api('POST', `${domainPath()}/verify`, ownerCookie, {})).statusCode).toBe(400)
  })

  it('is for owners and admins; others get 403, and strangers the same 404 as a missing team', async () => {
    const body = { domain: 'other.acme.com' }
    expect((await api('PUT', domainPath(), memberCookie, body)).statusCode).toBe(403)
    expect((await api('DELETE', domainPath(), memberCookie)).statusCode).toBe(403)
    expect((await api('POST', `${domainPath()}/verify`, memberCookie, {})).statusCode).toBe(403)
    // A plain member can look.
    const list = (await api('GET', '', memberCookie)).json()
    expect(list.canManage).toBe(false)
    expect(list.sites).toHaveLength(1)
    expect((await api('PUT', domainPath(), rivalCookie, body)).statusCode).toBe(404)
    expect((await api('GET', '', rivalCookie)).statusCode).toBe(404)
    expect((await api('PUT', '/no-such-site/domain', ownerCookie, body)).statusCode).toBe(404)
  })

  it('refuses names that share a cookie scope with the dashboard or belong to the sites domain, and taken ones', async () => {
    const set = (domain: string, cookie = ownerCookie) =>
      api('PUT', domainPath(), cookie, { domain })
    for (const bad of [
      'ci.acme.io',
      'acme.io',
      'storybook.acme.io',
      `x.${SITES}`,
      SITES,
      'https://a.acme.com',
      '*.acme.com',
    ]) {
      // eslint-disable-next-line no-await-in-loop -- a handful of requests
      const res = await set(bad)
      expect([bad, res.statusCode]).toEqual([bad, 400])
    }
    expect((await set(DOMAIN)).statusCode).toBe(200)

    // Another team's site can't take it, whoever holds it.
    const theirs = (await upload(MAIN1, 'main', 'r', rival.token, 'rival-sb')).json().site.slug
    const clash = await app.inject({
      method: 'PUT',
      url: `/api/teams/${rival.workspaceSlug}/web/sites/${theirs}/domain`,
      headers: { cookie: rivalCookie, origin: DASH, 'content-type': 'application/json' },
      payload: JSON.stringify({ domain: DOMAIN.toUpperCase() }),
    })
    expect(clash.statusCode).toBe(409)
    await api('DELETE', domainPath(), ownerCookie)
  })
})

const tlsAsk = (domain: string, headers: Record<string, string> = {}) =>
  app.inject({
    url: `/internal/tls-ask?domain=${encodeURIComponent(domain)}`,
    headers: { host: 'circi:3000', ...headers },
  })

describe('GET /internal/tls-ask (Caddy on-demand TLS)', () => {
  it('says yes only for a verified custom domain, with no body either way', async () => {
    await api('PUT', domainPath(), ownerCookie, { domain: DOMAIN })
    zone.cname = {}
    expect((await tlsAsk(DOMAIN)).statusCode).toBe(404) // claimed, not verified
    pointAtServer()
    await api('POST', `${domainPath()}/verify`, ownerCookie, {})
    const yes = await tlsAsk(DOMAIN)
    expect(yes.statusCode).toBe(200)
    expect(yes.body).toBe('')
    expect((await tlsAsk('STORYBOOK.acme.com.')).statusCode).toBe(200)

    const no = await tlsAsk('stranger.example.com')
    expect(no.statusCode).toBe(404)
    expect(no.body).toBe('')
  })

  it('leaves the wildcard alone and refuses junk, missing and proxied questions', async () => {
    expect((await tlsAsk(`abc123def456-web-storybook.${SITES}`)).statusCode).toBe(404)
    expect((await tlsAsk(SITES)).statusCode).toBe(404)
    expect((await tlsAsk('')).statusCode).toBe(404)
    expect((await tlsAsk('a b;drop')).statusCode).toBe(404)
    expect((await tlsAsk('x'.repeat(300))).statusCode).toBe(404)
    expect((await app.inject({ url: '/internal/tls-ask' })).statusCode).toBe(404)
    // A question that came through a proxy (the public internet) is never answered.
    expect((await tlsAsk(DOMAIN, { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(404)
    expect((await tlsAsk(DOMAIN, { forwarded: 'for=203.0.113.9' })).statusCode).toBe(404)
    // It is a question only: nothing else is served at that path.
    expect((await app.inject({ method: 'POST', url: '/internal/tls-ask' })).statusCode).toBe(404)
  })

  it('is rate limited', async () => {
    const limited = buildServer({
      logger: pino({ level: 'silent' }),
      checks: [],
      tlsAsk: { db: t.db, maxPerMinute: 3 },
    })
    const codes: number[] = []
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- in order
      codes.push((await limited.inject({ url: `/internal/tls-ask?domain=${DOMAIN}` })).statusCode)
    }
    expect(codes).toEqual([200, 200, 200, 429, 429])
    await limited.close()
  })
})

const siteGet = (path = '/', headers: Record<string, string> = {}, host = DOMAIN) =>
  app.inject({ url: path, headers: { host, ...headers } })

/** The dashboard hands the domain a token; the domain swaps it for its own cookie. */
async function openDomain(cookie = ownerCookie, host = DOMAIN) {
  const hand = await app.inject({
    method: 'POST',
    url: '/api/site-handoff',
    headers: { cookie, origin: DASH, 'content-type': 'application/json' },
    payload: JSON.stringify({ label: host, returnPath: '/' }),
  })
  if (hand.statusCode !== 200) return { hand, siteCookie: '' }
  const url = new URL(hand.json().url)
  expect(url.origin).toBe(`https://${host}`)
  const done = await siteGet(url.pathname + url.search, {}, host)
  const raw =
    [done.headers['set-cookie']]
      .flat()
      .map(String)
      .find((c) => c.startsWith('__Host-circi_site=')) ?? ''
  return { hand, done, siteCookie: raw.split(';')[0] ?? '' }
}

describe('serving the default branch on the custom domain', () => {
  it('sends a visitor to sign in with the domain as the address, then serves main', async () => {
    const first = await siteGet('/assets/x.js?y=1')
    expect(first.statusCode).toBe(302)
    const to = new URL(String(first.headers.location))
    expect(to.origin).toBe(DASH)
    expect(to.pathname).toBe('/_sso/site')
    expect(to.searchParams.get('host')).toBe(DOMAIN)
    expect(to.searchParams.get('return')).toBe('/assets/x.js?y=1')

    const { siteCookie, done } = await openDomain()
    expect(done?.statusCode).toBe(302)
    // Host-only, HttpOnly, no Domain: the cookie belongs to this host alone.
    const setCookie = [done?.headers['set-cookie']].flat().map(String).join('\n')
    expect(setCookie).toMatch(/__Host-circi_site=[^;]+; Path=\/; HttpOnly; SameSite=Lax/)
    expect(setCookie).not.toMatch(/;\s*Domain=/i)
    const page = await siteGet('/', { cookie: siteCookie })
    expect(page.statusCode).toBe(200)
    expect(page.body).toBe('v1')
    expect(page.headers['cache-control']).toBe('private, no-cache')
  })

  it('follows the default branch: a newer main upload shows, a feature branch does not', async () => {
    const { siteCookie } = await openDomain()
    await upload(MAIN2, 'main', 'v2', acme.token)
    expect((await siteGet('/', { cookie: siteCookie })).body).toBe('v2')
    await upload(FEATURE, 'feature/x', 'feature', acme.token)
    expect((await siteGet('/', { cookie: siteCookie })).body).toBe('v2')
  })

  it("uses the team's default branch setting; with no upload on it, answers like an unknown address", async () => {
    const { siteCookie } = await openDomain()
    await t.db
      .update(schema.teams)
      .set({ defaultBranch: 'release' })
      .where(eq(schema.teams.id, acme.team.id))
    const empty = await siteGet('/', { cookie: siteCookie })
    const unknown = await siteGet('/', {}, `${'0'.repeat(12)}-nothing-here.${SITES}`)
    expect(empty.statusCode).toBe(302)
    expect(`${empty.statusCode} ${new URL(String(empty.headers.location)).pathname}`).toBe(
      `${unknown.statusCode} ${new URL(String(unknown.headers.location)).pathname}`,
    )
    // The handoff refuses it too: no token for an address with nothing to show.
    expect((await openDomain()).hand.statusCode).toBe(404)
    await t.db
      .update(schema.teams)
      .set({ defaultBranch: 'main' })
      .where(eq(schema.teams.id, acme.team.id))
    expect((await siteGet('/', { cookie: siteCookie })).statusCode).toBe(200)
  })

  it('keeps the same answer for outsiders, and a cookie never works on another address', async () => {
    expect((await openDomain(rivalCookie)).hand.statusCode).toBe(404)
    const { siteCookie } = await openDomain()
    // The cookie is bound to the domain: replayed on a commit address it is just a stranger.
    const commit = (await upload(MAIN2, 'main', 'v2', acme.token)).json().addresses.commit
    const replay = await siteGet('/', { cookie: siteCookie }, new URL(commit).hostname)
    expect(replay.statusCode).toBe(302)
    expect(new URL(String(replay.headers.location)).pathname).toBe('/_sso/site')
    // And a token for the domain is no good for a commit address (it is bound to its address).
    const hand = await app.inject({
      method: 'POST',
      url: '/api/site-handoff',
      headers: { cookie: ownerCookie, origin: DASH, 'content-type': 'application/json' },
      payload: JSON.stringify({ label: DOMAIN }),
    })
    const token = new URL(hand.json().url).searchParams.get('t')
    const wrong = await siteGet(`/_circi/auth?t=${token}`, {}, new URL(commit).hostname)
    expect(wrong.headers['set-cookie']).toBeUndefined()
  })

  it('serves a domain only while it is verified, and only for sites; other hosts are untouched', async () => {
    const { siteCookie } = await openDomain()
    await t.db
      .update(schema.teamSites)
      .set({ customDomainVerifiedAt: null })
      .where(eq(schema.teamSites.slug, slug))
    // Not verified: not a site host any more, so the request reaches the ordinary routes.
    const gone = await siteGet('/healthz', { cookie: siteCookie })
    expect(gone.json()).toEqual({ status: 'ok' })
    await api('POST', `${domainPath()}/verify`, ownerCookie, {})
    expect((await siteGet('/', { cookie: siteCookie })).statusCode).toBe(200)

    // A site host never reaches a dashboard route; the dashboard host never serves a file.
    expect((await siteGet('/api/teams', { cookie: siteCookie })).statusCode).toBe(404)
    expect((await siteGet('/healthz', { cookie: siteCookie })).statusCode).toBe(404)
    const dash = await siteGet('/healthz', {}, 'ci.acme.io')
    expect(dash.json()).toEqual({ status: 'ok' })
    expect((await siteGet('/healthz', {}, 'circi:3000')).statusCode).toBe(200)
  })

  it('is read-only like every site, and removing the domain ends it', async () => {
    const post = await app.inject({ method: 'POST', url: '/', headers: { host: DOMAIN } })
    expect(post.statusCode).toBe(405)
    const { siteCookie } = await openDomain()
    await api('DELETE', domainPath(), ownerCookie)
    expect((await siteGet('/healthz', { cookie: siteCookie })).json()).toEqual({ status: 'ok' })
    expect((await tlsAsk(DOMAIN)).statusCode).toBe(404)
  })
})
