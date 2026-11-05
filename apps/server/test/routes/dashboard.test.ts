import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Auth } from '@circi/auth'
import { createBuild, finalizeBuild, markFileVerified, planUploads } from '@circi/db'
import { contentKey, FsStorage } from '@circi/storage'
import { processBuild } from '@circi/worker'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDb, type TestDb } from '../../../../packages/db/test/helpers.ts'
import { buildServer } from '../../src/http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '../helpers.ts'

const logger = pino({ level: 'silent' })
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

let t: TestDb
let dir: string
let storage: FsStorage
let app: FastifyInstance
let betterAuth: Auth
/** Two unrelated organizations: `acme` has builds, `rival` is someone else. */
let acme: Tenant
let rival: Tenant
let acmeCookie: string
let rivalCookie: string

async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 40, channels: 4, background: color } })
    .png()
    .toBuffer()
}

async function buildWith(
  projectId: string,
  commitSha: string,
  ancestors: string[],
  shots: Record<string, Buffer>,
) {
  const b = await createBuild(t.db, {
    projectId,
    commitSha,
    branch: 'main',
    ancestorShas: ancestors,
  })
  const planned = await planUploads(t.db, {
    buildId: b.id,
    kind: 'screenshot',
    files: Object.values(shots).map((v) => ({
      sha256: sha(v),
      size: v.length,
      contentType: 'image/png',
    })),
    storageKeyFor: (s) => contentKey(s),
  })
  await Promise.all(
    planned.map(async (p) => {
      const bytes = Object.values(shots).find((v) => sha(v) === p.sha256) ?? Buffer.alloc(0)
      await storage.put(p.storageKey, bytes)
      await markFileVerified(t.db, p.sha256, { size: bytes.length })
    }),
  )
  await finalizeBuild(t.db, {
    buildId: b.id,
    screenshots: Object.entries(shots).map(([name, v]) => ({ name, sha256: sha(v) })),
  })
  await processBuild({ db: t.db, storage }, b.id)
  return b
}

beforeAll(async () => {
  t = await createTestDb()
  betterAuth = createTestAuth(t.db)
  dir = await mkdtemp(join(tmpdir(), 'circi-dash-'))
  storage = new FsStorage({ path: join(dir, 'files') })
  const webDist = join(dir, 'web')
  await mkdir(join(webDist, 'assets'), { recursive: true })
  await writeFile(join(webDist, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(webDist, 'assets', 'app-1a2b3c.js'), 'console.log(1)')
  app = buildServer({
    logger,
    checks: [],
    dashboard: { db: t.db, auth: betterAuth, storage, publicOrigin: ORIGIN, webDist },
  })
  await app.ready()

  acme = await seedTenant(betterAuth, t.db)
  rival = await seedTenant(betterAuth, t.db)
  acmeCookie = await signIn(app, acme.owner.email, acme.owner.password)
  rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)

  await buildWith(acme.project.id, 'aaaa001', [], {
    home: await png('#ffffff'),
    about: await png('#eeeeee'),
  })
  await buildWith(acme.project.id, 'aaaa002', ['aaaa001'], {
    home: await png('#ff0000'),
    about: await png('#eeeeee'),
  })
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

/** GET as Acme's owner by default; pass '' for no session at all. */
const get = (url: string, cookie: string = acmeCookie) =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

async function buildDetail(cookie: string, orgSlug = acme.orgSlug) {
  return get(`/api/projects/${orgSlug}/web/builds/2`, cookie)
}

describe('signing in', () => {
  it('needs a session for the dashboard API', async () => {
    const res = await get('/api/projects', '')
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'Sign in to continue' })
  })

  it('signs in with email and password, and the cookie works', async () => {
    const res = await get('/api/projects', acmeCookie)
    expect(res.statusCode).toBe(200)
  })

  it('sets a __Host- session cookie: Secure, HttpOnly, no Domain, Path=/', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: acme.owner.email, password: acme.owner.password },
    })
    const cookies = [res.headers['set-cookie']]
      .flat()
      .filter((c): c is string => typeof c === 'string')
    const session = cookies.find((c) => c.startsWith('__Host-circi.session_token='))
    expect(session).toBeDefined()
    expect(session).toMatch(/;\s*Secure/i)
    expect(session).toMatch(/;\s*HttpOnly/i)
    expect(session).toMatch(/;\s*Path=\//i)
    expect(session).not.toMatch(/;\s*Domain=/i)
    // Every cookie better-auth sets must qualify for the prefix, or browsers drop it.
    for (const c of cookies) expect(c.startsWith('__Host-')).toBe(true)
  })

  it('refuses a wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: acme.owner.email, password: 'definitely-the-wrong-one' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('has no self sign-up: accounts come from the admin CLI', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        email: 'stranger@example.com',
        name: 'Stranger',
        password: 'a-very-long-password-1',
      },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    const projects = await get('/api/projects', '')
    expect(projects.statusCode).toBe(401)
  })

  it('reports who is signed in, and nobody when signed out', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie: acmeCookie },
    })
    expect(me.json()).toMatchObject({ user: { email: acme.owner.email } })
    const nobody = await app.inject({ method: 'GET', url: '/api/auth/get-session' })
    expect(nobody.json()).toBeNull()
  })

  it('stops working after signing out', async () => {
    const cookie = await signIn(app, acme.owner.email, acme.owner.password)
    expect((await get('/api/projects', cookie)).statusCode).toBe(200)
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { origin: ORIGIN, cookie, 'content-type': 'application/json' },
      payload: {},
    })
    expect(out.statusCode).toBe(200)
    expect((await get('/api/projects', cookie)).statusCode).toBe(401)
  })

  it('does not accept a CI token as a dashboard session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: `Bearer ${acme.token}` },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('organization isolation', () => {
  it('lists only the signed-in user’s projects', async () => {
    const mine = (await get('/api/projects', acmeCookie)).json().projects
    expect(mine.map((p: { org: { slug: string } }) => p.org.slug)).toEqual([acme.orgSlug])
    const theirs = (await get('/api/projects', rivalCookie)).json().projects
    expect(theirs.map((p: { org: { slug: string } }) => p.org.slug)).toEqual([rival.orgSlug])
  })

  it('answers “not found” for another organization’s project and builds', async () => {
    const urls = [`/api/projects/${acme.orgSlug}/web`, `/api/projects/${acme.orgSlug}/web/builds/2`]
    const asked = await Promise.all(
      urls.flatMap((url) => [get(url, rivalCookie), get(`${url}x`, rivalCookie)]),
    )
    // Real and made-up projects get the same answer, so nothing reveals what exists.
    expect(asked.map((r) => r.statusCode)).toEqual([404, 404, 404, 404])
  })

  it('serves a screenshot only to members of its organization', async () => {
    const detail = (await buildDetail(acmeCookie)).json()
    const home = detail.diffs.find((d: { name: string }) => d.name === 'home')
    const url = `/api/files/${home.head.sha256}`
    expect((await get(url, acmeCookie)).statusCode).toBe(200)
    expect((await get(url, rivalCookie)).statusCode).toBe(404)
    expect((await get(url, '')).statusCode).toBe(401)
    // A cached copy mustn't get past a lost membership either.
    const revalidate = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: rivalCookie, 'if-none-match': `"${home.head.sha256}"` },
    })
    expect(revalidate.statusCode).toBe(404)
  })
})

describe('API', () => {
  it('lists projects with their latest build', async () => {
    const p = (await get('/api/projects')).json().projects[0]
    expect(p.latestBuild).toMatchObject({
      number: 2,
      status: 'complete',
      counts: { changed: 1, unchanged: 1 },
    })
  })

  it("lists a project's builds, newest first", async () => {
    const res = await get(`/api/projects/${acme.orgSlug}/web`)
    expect(res.json().builds.map((b: { number: number }) => b.number)).toEqual([2, 1])
    expect((await get(`/api/projects/${acme.orgSlug}/nope`)).statusCode).toBe(404)
  })

  it('returns a build with its baseline and image references', async () => {
    const res = await buildDetail(acmeCookie)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.baseline).toMatchObject({ number: 1, commitSha: 'aaaa001' })
    expect(body.build).toMatchObject({
      baselineSource: 'cli',
      counts: { changed: 1, unchanged: 1, total: 2 },
    })
    const home = body.diffs.find((d: { name: string }) => d.name === 'home')
    expect(home).toMatchObject({
      status: 'changed',
      head: { width: 60, height: 40, thumbnail: expect.stringMatching(/^[0-9a-f]{64}$/) },
      base: { width: 60, height: 40 },
      diff: { width: 60, height: 40 },
    })
    expect((await get(`/api/projects/${acme.orgSlug}/web/builds/99`)).statusCode).toBe(404)
  })

  it('serves files by hash with permanent caching', async () => {
    const home = (await buildDetail(acmeCookie))
      .json()
      .diffs.find((d: { name: string }) => d.name === 'home')
    const res = await get(`/api/files/${home.head.sha256}`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(sha(res.rawPayload)).toBe(home.head.sha256)
    const cached = await app.inject({
      method: 'GET',
      url: `/api/files/${home.head.sha256}`,
      headers: { cookie: acmeCookie, 'if-none-match': `"${home.head.sha256}"` },
    })
    expect(cached.statusCode).toBe(304)
    expect((await get(`/api/files/${'0'.repeat(64)}`)).statusCode).toBe(404)
    expect((await get('/api/files/not-a-hash')).statusCode).toBe(404)
  })
})

describe('web app', () => {
  it('serves the app shell to everyone, so it can show the sign-in page', async () => {
    const res = await get(`/${acme.orgSlug}/web/builds/2`, '')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('caches hashed assets for good', async () => {
    const res = await get('/assets/app-1a2b3c.js', '')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('answers unknown API paths with JSON 404s, not the app shell', async () => {
    const res = await get('/api/nope', acmeCookie)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })
})

const review = (
  state: unknown,
  options: {
    cookie?: string
    origin?: string | null
    org?: string
    build?: number
    headers?: Record<string, string>
  } = {},
) =>
  app.inject({
    method: 'POST',
    url: `/api/projects/${options.org ?? acme.orgSlug}/web/builds/${options.build ?? 2}/review`,
    headers: {
      'content-type': 'application/json',
      ...(options.cookie === '' ? {} : { cookie: options.cookie ?? acmeCookie }),
      ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
      ...options.headers,
    },
    payload: { state },
  })
const reviewStatus = async () => (await buildDetail(acmeCookie)).json().build.reviewStatus

describe('reviewing a build', () => {
  it('starts approved on the default branch, and says it was automatic', async () => {
    expect(await reviewStatus()).toBe('approved')
    expect((await buildDetail(acmeCookie)).json().reviews).toEqual([
      { state: 'approved', source: 'auto', userName: null, createdAt: expect.any(String) },
    ])
  })

  it('lets a member reject, and then shows who did', async () => {
    const res = await review('rejected')
    expect(res.statusCode).toBe(200)
    expect(res.json().build).toMatchObject({ number: 2, reviewStatus: 'rejected' })

    const detail = (await buildDetail(acmeCookie)).json()
    expect(detail.build.reviewStatus).toBe('rejected')
    expect(detail.reviews[0]).toEqual({
      state: 'rejected',
      source: 'ui',
      userName: expect.stringMatching(/^Owner \d+$/),
      createdAt: expect.any(String),
    })
    expect((await get('/api/projects')).json().projects[0].latestBuild.reviewStatus).toBe(
      'rejected',
    )
  })

  it('lets them change their mind, keeping the history', async () => {
    expect((await review('approved')).json().build.reviewStatus).toBe('approved')
    expect(
      (await buildDetail(acmeCookie))
        .json()
        .reviews.map((r: { state: string; source: string }) => [r.state, r.source]),
    ).toEqual([
      ['approved', 'ui'],
      ['rejected', 'ui'],
      ['approved', 'auto'],
    ])
  })

  it('needs a session', async () => {
    expect((await review('rejected', { cookie: '' })).statusCode).toBe(401)
    expect(await reviewStatus()).toBe('approved')
  })

  it('keeps other organizations out, with the same answer as for a missing build', async () => {
    const theirs = await review('rejected', { cookie: rivalCookie })
    const missing = await review('rejected', { cookie: rivalCookie, build: 99 })
    expect([theirs.statusCode, missing.statusCode]).toEqual([404, 404])
    expect(theirs.json()).toEqual(missing.json())
    expect(await reviewStatus()).toBe('approved')
  })

  it('refuses a request from another site, even with the right cookie', async () => {
    const fromEvilSite = await review('rejected', { origin: 'https://sb.example-sites.com' })
    expect(fromEvilSite.statusCode).toBe(403)
    const crossSiteNoOrigin = await review('rejected', {
      origin: null,
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(crossSiteNoOrigin.statusCode).toBe(403)
    expect(await reviewStatus()).toBe('approved')
  })

  it('accepts a request that carries no browser headers at all (curl, scripts)', async () => {
    expect((await review('approved', { origin: null })).statusCode).toBe(200)
  })

  it('rejects anything but approved or rejected', async () => {
    for (const state of ['pending', 'maybe', 5, undefined]) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      expect((await review(state)).statusCode).toBe(400)
    }
  })

  it('refuses a build with no changes to decide on', async () => {
    // Same screenshots as build 1 (approved), so build 3 matches its baseline exactly.
    await buildWith(acme.project.id, 'aaaa003', ['aaaa001'], {
      home: await png('#ffffff'),
      about: await png('#eeeeee'),
    })
    const res = await review('approved', { build: 3 })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/no changes to review/)
  })
})
