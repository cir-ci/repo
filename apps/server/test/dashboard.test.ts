import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBuild, finalizeBuild, markFileVerified, planUploads } from '@circi/db'
import { contentKey, FsStorage } from '@circi/storage'
import { processBuild } from '@circi/worker'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDb, seedProject, type TestDb } from '../../../packages/db/test/helpers.ts'
import { checkBasicAuth } from '../src/dashboard.ts'
import { buildServer } from '../src/http.ts'

const PASSWORD = 'correct-horse-battery'
const logger = pino({ level: 'silent' })
const basic = (password: string) => `Basic ${Buffer.from(`any:${password}`).toString('base64')}`
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

let t: TestDb
let dir: string
let storage: FsStorage
let app: FastifyInstance
let orgSlug: string

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
  dir = await mkdtemp(join(tmpdir(), 'circi-dash-'))
  storage = new FsStorage({ path: join(dir, 'files') })
  const webDist = join(dir, 'web')
  await mkdir(join(webDist, 'assets'), { recursive: true })
  await writeFile(join(webDist, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(webDist, 'assets', 'app-1a2b3c.js'), 'console.log(1)')
  app = buildServer({
    logger,
    checks: [],
    dashboard: { db: t.db, storage, password: PASSWORD, webDist },
  })
  await app.ready()

  const { project } = await seedProject(t.db)
  orgSlug =
    (await t.db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.id, project.orgId) }))
      ?.slug ?? ''
  await buildWith(project.id, 'aaaa001', [], {
    home: await png('#ffffff'),
    about: await png('#eeeeee'),
  })
  await buildWith(project.id, 'aaaa002', ['aaaa001'], {
    home: await png('#ff0000'),
    about: await png('#eeeeee'),
  })
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const get = (url: string, headers: Record<string, string> = { authorization: basic(PASSWORD) }) =>
  app.inject({ method: 'GET', url, headers })

describe('access', () => {
  it('is off without a password, and says how to turn it on', async () => {
    const off = buildServer({ logger, checks: [], dashboard: { db: t.db, storage } })
    try {
      const api = await off.inject({ method: 'GET', url: '/api/projects' })
      expect(api.statusCode).toBe(503)
      expect(api.json().error).toMatch(/DASHBOARD_PASSWORD/)
      const html = await off.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } })
      expect(html.statusCode).toBe(503)
      expect(html.body).toContain('DASHBOARD_PASSWORD')
      // Health checks never go through the dashboard gate.
      expect((await off.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200)
    } finally {
      await off.close()
    }
  })

  it('asks for the password, and accepts any username with the right one', async () => {
    const none = await get('/api/projects', {})
    expect(none.statusCode).toBe(401)
    expect(none.headers['www-authenticate']).toMatch(/^Basic realm="CirCI"/)
    expect(
      (await get('/api/projects', { authorization: basic('wrong-password-here') })).statusCode,
    ).toBe(401)
    expect((await get('/api/projects')).statusCode).toBe(200)
  })

  it('compares passwords safely', () => {
    expect(checkBasicAuth(basic(PASSWORD), PASSWORD)).toBe(true)
    expect(checkBasicAuth(basic(`${PASSWORD}x`), PASSWORD)).toBe(false)
    expect(checkBasicAuth('Basic !!!', PASSWORD)).toBe(false)
    expect(checkBasicAuth('Bearer x', PASSWORD)).toBe(false)
  })
})

describe('API', () => {
  it('lists projects with their latest build', async () => {
    const res = await get('/api/projects')
    const p = res.json().projects.find((x: { org: { slug: string } }) => x.org.slug === orgSlug)
    expect(p.latestBuild).toMatchObject({
      number: 2,
      status: 'complete',
      counts: { changed: 1, unchanged: 1 },
    })
  })

  it("lists a project's builds, newest first", async () => {
    const res = await get(`/api/projects/${orgSlug}/web`)
    expect(res.json().builds.map((b: { number: number }) => b.number)).toEqual([2, 1])
    expect((await get(`/api/projects/${orgSlug}/nope`)).statusCode).toBe(404)
  })

  it('returns a build with its baseline and image references', async () => {
    const res = await get(`/api/projects/${orgSlug}/web/builds/2`)
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
    expect((await get(`/api/projects/${orgSlug}/web/builds/99`)).statusCode).toBe(404)
  })

  it('serves files by hash with permanent caching', async () => {
    const home = (await get(`/api/projects/${orgSlug}/web/builds/2`))
      .json()
      .diffs.find((d: { name: string }) => d.name === 'home')
    const res = await get(`/api/files/${home.head.sha256}`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(sha(res.rawPayload)).toBe(home.head.sha256)
    const cached = await get(`/api/files/${home.head.sha256}`, {
      authorization: basic(PASSWORD),
      'if-none-match': `"${home.head.sha256}"`,
    })
    expect(cached.statusCode).toBe(304)
    expect((await get(`/api/files/${'0'.repeat(64)}`)).statusCode).toBe(404)
    expect((await get('/api/files/not-a-hash')).statusCode).toBe(404)
  })
})

describe('web app', () => {
  it('serves the app shell for client-side routes', async () => {
    const res = await get(`/${orgSlug}/web/builds/2`)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('caches hashed assets for good', async () => {
    const res = await get('/assets/app-1a2b3c.js')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('answers unknown API paths with JSON 404s, not the app shell', async () => {
    const res = await get('/api/nope')
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })
})
