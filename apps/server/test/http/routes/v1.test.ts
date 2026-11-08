import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import type { Auth } from '@circi/auth'
import { rotateProjectToken } from '@circi/auth'
import { getFile } from '@circi/db'
import {
  FsStorage,
  type ObjectInfo,
  type PresignedPut,
  type PutResult,
  type StorageDriver,
} from '@circi/storage'
import { createTestDb, type TestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '../../../src/http/app.ts'
import { createTestAuth, ORIGIN, seedTenant } from '../../support/helpers.ts'

const logger = pino({ level: 'silent' })
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const png = (text: string) => Buffer.from(`\x89PNG fake ${text}`)

let t: TestDb
let dir: string
let app: FastifyInstance
let betterAuth: Auth

beforeAll(async () => {
  t = await createTestDb()
  betterAuth = createTestAuth(t.db)
  dir = await mkdtemp(join(tmpdir(), 'circi-api-'))
  app = buildServer({
    logger,
    checks: [],
    api: {
      db: t.db,
      auth: betterAuth,
      storage: new FsStorage({ path: dir }),
      publicOrigin: ORIGIN,
    },
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const auth = (token: string) => ({ authorization: `Bearer ${token}` })
const fileEntry = (b: Buffer) => ({ sha256: sha256(b), size: b.length, contentType: 'image/png' })

async function createBuild(token: string, files: Buffer[], extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/builds',
    headers: auth(token),
    payload: { commitSha: 'abcdef1', branch: 'main', files: files.map(fileEntry), ...extra },
  })
}

async function upload(token: string, b: Buffer, hash = sha256(b)) {
  return app.inject({
    method: 'PUT',
    url: `/v1/files/${hash}`,
    headers: { ...auth(token), 'content-type': 'image/png' },
    payload: b,
  })
}

describe('authentication', () => {
  it('requires a valid project token', async () => {
    const none = await app.inject({ method: 'GET', url: '/v1/project' })
    expect(none.statusCode).toBe(401)
    expect(none.headers['www-authenticate']).toBe('Bearer')
    const wrong = await app.inject({
      method: 'GET',
      url: '/v1/project',
      headers: auth(`circi_${'x'.repeat(43)}`),
    })
    expect(wrong.statusCode).toBe(401)
  })

  it('describes the token’s project', async () => {
    const { project, token } = await seedTenant(betterAuth, t.db, { defaultBranch: 'trunk' })
    const res = await app.inject({ method: 'GET', url: '/v1/project', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ slug: project.slug, defaultBranch: 'trunk' })
    expect(res.json().dashboardUrl).toMatch(new RegExp(`^${ORIGIN}/org-\\d+/web$`))
  })

  it('stops accepting a token as soon as it is rotated', async () => {
    const tenant = await seedTenant(betterAuth, t.db)
    const ok = await app.inject({ method: 'GET', url: '/v1/project', headers: auth(tenant.token) })
    expect(ok.statusCode).toBe(200)
    const { token: fresh } = await rotateProjectToken(betterAuth, t.db, {
      orgSlug: tenant.orgSlug,
      projectSlug: 'web',
    })
    const old = await app.inject({ method: 'GET', url: '/v1/project', headers: auth(tenant.token) })
    expect(old.statusCode).toBe(401)
    const now = await app.inject({ method: 'GET', url: '/v1/project', headers: auth(fresh) })
    expect(now.statusCode).toBe(200)
  })

  it('does not take a dashboard session as a CI credential', async () => {
    const tenant = await seedTenant(betterAuth, t.db)
    const res = await app.inject({
      method: 'GET',
      url: '/v1/project',
      headers: { authorization: `Bearer ${tenant.owner.password}` },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('upload flow (local-disk storage)', () => {
  it('creates a build, uploads through the API, finalizes and enqueues processing', async () => {
    const { token } = await seedTenant(betterAuth, t.db)
    const a = png('a')
    const b = png('b')
    const created = await createBuild(token, [a, b])
    expect(created.statusCode).toBe(201)
    const body = created.json()
    expect(body.build).toMatchObject({ number: 1, status: 'uploading' })
    expect(body.build.url).toMatch(/\/builds\/1$/)
    expect(body.uploads).toHaveLength(2)
    expect(body.uploads[0]).toMatchObject({
      method: 'PUT',
      auth: 'token',
      url: expect.stringMatching(new RegExp(`^${ORIGIN}/v1/files/[0-9a-f]{64}$`)),
    })

    const uploaded = await Promise.all([a, b].map((f) => upload(token, f)))
    expect(uploaded.map((r) => r.statusCode)).toEqual([201, 201])

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/builds/${body.build.id}/finalize`,
      headers: auth(token),
      payload: {
        screenshots: [
          { name: 'home', sha256: sha256(a) },
          { name: 'login', sha256: sha256(b), metadata: { browser: 'chromium' } },
        ],
      },
    })
    expect(fin.statusCode).toBe(200)
    expect(fin.json()).toMatchObject({ complete: true, build: { status: 'processing' } })

    const status = await app.inject({
      method: 'GET',
      url: `/v1/builds/${body.build.id}/status`,
      headers: auth(token),
    })
    expect(status.json()).toMatchObject({
      outcome: { state: 'pending' },
      gate: 'exit-code',
      build: { status: 'processing' },
    })
  })

  it('does not ask for files the server already has (dedup)', async () => {
    const { token } = await seedTenant(betterAuth, t.db)
    const c = png('c')
    const first = (await createBuild(token, [c])).json()
    await upload(token, c)
    expect(first.uploads).toHaveLength(1)
    const second = (await createBuild(token, [c])).json()
    expect(second.uploads).toEqual([])
  })

  it('rejects bytes that do not match the hash and stores nothing', async () => {
    const { token } = await seedTenant(betterAuth, t.db)
    const good = png('good')
    await createBuild(token, [good])
    const res = await upload(token, png('evil'), sha256(good))
    expect(res.statusCode).toBe(422)
    const row = await getFile(t.db, sha256(good))
    expect(row?.status).toBe('pending')
  })

  it('refuses uploads nobody asked for', async () => {
    const { token } = await seedTenant(betterAuth, t.db)
    expect((await upload(token, png('unrequested'))).statusCode).toBe(404)
  })

  it('answers 409 with the missing hashes when finalizing too early', async () => {
    const { token } = await seedTenant(betterAuth, t.db)
    const d = png('d')
    const build = (await createBuild(token, [d])).json().build
    const res = await app.inject({
      method: 'POST',
      url: `/v1/builds/${build.id}/finalize`,
      headers: auth(token),
      payload: { screenshots: [{ name: 'x', sha256: sha256(d) }] },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().missing).toEqual([sha256(d)])
  })

  it('validates input', async () => {
    const { token } = await seedTenant(betterAuth, t.db)
    const jpeg = await app.inject({
      method: 'POST',
      url: '/v1/builds',
      headers: auth(token),
      payload: {
        commitSha: 'abcdef1',
        files: [{ sha256: 'a'.repeat(64), size: 1, contentType: 'image/jpeg' }],
      },
    })
    expect(jpeg.statusCode).toBe(400)
    expect(jpeg.json().error).toMatch(/files\.0\.contentType/)
    const badSha = await app.inject({
      method: 'POST',
      url: '/v1/builds',
      headers: auth(token),
      payload: { commitSha: 'nope', files: [] },
    })
    expect(badSha.statusCode).toBe(400)
  })

  it("hides other projects' builds", async () => {
    const owner = await seedTenant(betterAuth, t.db)
    const other = await seedTenant(betterAuth, t.db)
    const build = (await createBuild(owner.token, [])).json().build
    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${build.id}/status`,
      headers: auth(other.token),
    })
    expect(res.statusCode).toBe(404)
  })
})

/** Minimal S3 stand-in: presigned URLs, and `head` reporting the checksum of what was "uploaded". */
class FakeS3 implements StorageDriver {
  readonly kind = 's3' as const
  readonly objects = new Map<string, Buffer>()
  async put(key: string, body: Readable | Uint8Array): Promise<PutResult> {
    const bytes =
      body instanceof Uint8Array ? Buffer.from(body) : Buffer.concat(await body.toArray())
    this.objects.set(key, bytes)
    return { size: bytes.length, sha256: sha256(bytes) }
  }
  async get(key: string): Promise<Readable> {
    return Readable.from([this.objects.get(key) ?? Buffer.alloc(0)])
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const b = this.objects.get(key)
    return b ? { size: b.length, sha256: sha256(b) } : null
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
  async presignPut(key: string): Promise<PresignedPut> {
    return {
      url: `https://s3.example/${key}?sig=x`,
      method: 'PUT',
      headers: { 'x-amz-checksum-sha256': 'x' },
    }
  }
  async healthCheck(): Promise<void> {}
}

describe('upload flow (direct-to-S3)', () => {
  it('hands out presigned URLs and verifies the stored checksum at finalize', async () => {
    const s3 = new FakeS3()
    const s3App = buildServer({
      logger,
      checks: [],
      api: { db: t.db, auth: betterAuth, storage: s3, publicOrigin: ORIGIN },
    })
    await s3App.ready()
    try {
      const { token } = await seedTenant(betterAuth, t.db)
      const e = png('s3-e')
      const created = await s3App.inject({
        method: 'POST',
        url: '/v1/builds',
        headers: auth(token),
        payload: { commitSha: 'abcdef1', files: [fileEntry(e)] },
      })
      const { build, uploads } = created.json()
      expect(uploads[0]).toMatchObject({
        auth: 'none',
        url: expect.stringContaining('https://s3.example/'),
      })

      const finalize = () =>
        s3App.inject({
          method: 'POST',
          url: `/v1/builds/${build.id}/finalize`,
          headers: auth(token),
          payload: { screenshots: [{ name: 'e', sha256: sha256(e) }] },
        })
      // Nothing uploaded yet → missing.
      expect((await finalize()).statusCode).toBe(409)

      // The client uploads straight to "S3"; the key comes from the URL the server handed out.
      const key = new URL(uploads[0].url).pathname.slice(1)
      await s3.put(key, png('tampered'))
      expect((await finalize()).statusCode).toBe(409)

      await s3.put(key, e)
      const ok = await finalize()
      expect(ok.statusCode).toBe(200)
      expect(ok.json()).toMatchObject({ complete: true })
    } finally {
      await s3App.close()
    }
  })
})
