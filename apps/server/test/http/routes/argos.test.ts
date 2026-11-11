import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { reviewBuild } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { sha256, pngBytes } from '@circi/testing'
import { processBuild } from '@circi/worker'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, type Tenant } from '#test/support/helpers.ts'

/**
 * Plays the sequence `@argos-ci/core`'s `upload()` performs, from its source: GET /project,
 * POST /baseline, POST /builds, a multipart upload per file, PUT /builds/:id (in chunks, the
 * last one `final`). Not the real SDK: see the README's note on Argos compatibility.
 */

let t: createTestDb.Result
let dir: string
let storage: FsStorage
let app: FastifyInstance
let tenant: Tenant
const auth = () => ({ authorization: `Bearer ${tenant.token}` })

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-argos-'))
  storage = new FsStorage({ path: join(dir, 'files') })
  const betterAuth = createTestAuth(t.db)
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    api: { db: t.db, auth: betterAuth, storage, publicOrigin: ORIGIN },
  })
  await app.ready()
  tenant = await seedTenant(betterAuth, t.db)
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const png = (color: string) => pngBytes({ width: 40, height: 30, color })

const commitOf = (n: number) => n.toString(16).padStart(7, '0')

async function createArgosBuild(body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/builds',
    headers: auth(),
    payload: body,
  })
  return { res, json: res.json() }
}

async function uploadTo(
  target: { postUrl: string; fields: Record<string, string> },
  bytes: Buffer,
) {
  const form = new FormData()
  for (const [k, v] of Object.entries(target.fields)) form.append(k, v)
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'shot.png')
  const url = new URL(target.postUrl)
  return app.inject({ method: 'POST', url: url.pathname, payload: form })
}

/** One whole `upload()`: create, upload what's asked for, send names, finalize. */
async function argosUpload(options: {
  commit: string
  branch: string
  shots: Record<string, Buffer>
  parents?: string[]
  extra?: Record<string, unknown>
}) {
  const keys = Object.fromEntries(Object.entries(options.shots).map(([n, b]) => [n, sha256(b)]))
  const { res, json } = await createArgosBuild({
    commit: options.commit,
    branch: options.branch,
    name: 'default',
    screenshots: Object.values(keys).map((key) => ({ key, contentType: 'image/png' })),
    parentCommits: options.parents ?? [],
    ...options.extra,
  })
  expect(res.statusCode).toBe(201)
  const statuses = await Promise.all(
    json.screenshots.map(
      async (target: { key: string; postUrl: string; fields: Record<string, string> }) => {
        const bytes =
          Object.values(options.shots).find((b) => sha256(b) === target.key) ?? Buffer.alloc(0)
        return (await uploadTo(target, bytes)).statusCode
      },
    ),
  )
  expect(statuses.every((c) => c === 204)).toBe(true)
  const put = await app.inject({
    method: 'PUT',
    url: `/v2/builds/${json.build.id}`,
    headers: auth(),
    payload: {
      screenshots: Object.entries(keys).map(([name, key]) => ({
        key,
        name,
        metadata: { browser: 'chromium' },
      })),
      final: true,
    },
  })
  const buildId: string = json.build.id
  return { buildId, put, created: json }
}

const shard = async (index: number, bytes: Buffer, name: string) => {
  const { json } = await createArgosBuild({
    commit: commitOf(0xd01),
    branch: 'main',
    parallel: true,
    parallelNonce: 'ci-run-1',
    screenshots: [{ key: sha256(bytes), contentType: 'image/png' }],
  })
  await Promise.all(
    json.screenshots.map(
      (target: { key: string; postUrl: string; fields: Record<string, string> }) =>
        uploadTo(target, bytes),
    ),
  )
  const put = await app.inject({
    method: 'PUT',
    url: `/v2/builds/${json.build.id}`,
    headers: auth(),
    payload: {
      screenshots: [{ key: sha256(bytes), name }],
      parallel: true,
      parallelTotal: 2,
      parallelIndex: index,
      final: true,
    },
  })
  const result: { id: string; status: string } = {
    id: json.build.id,
    status: put.json().build.status,
  }
  return result
}

describe('Argos-compatible API', () => {
  it('describes the project for the SDK', async () => {
    const res = await app.inject({ url: '/v2/project', headers: auth() })
    expect(res.json()).toMatchObject({ defaultBaseBranch: 'main', hasRemoteContentAccess: false })
    expect((await app.inject({ url: '/v2/project' })).statusCode).toBe(401)
  })

  it('runs the whole upload sequence, and the build is processed like any other', async () => {
    const a = await argosUpload({
      commit: commitOf(0xa01),
      branch: 'main',
      shots: { home: await png('#ffffff'), about: await png('#eeeeee') },
    })
    expect(a.put.statusCode).toBe(200)
    expect(a.put.json().build.url).toContain('/builds/')
    expect((await processBuild({ db: t.db, storage }, a.buildId)).status).toBe('complete')
    // The project's first build waits for review; until it is approved it is no baseline.
    const early = await app.inject({
      method: 'POST',
      url: '/v2/baseline',
      headers: auth(),
      payload: { commits: [commitOf(0xa01)], name: 'default' },
    })
    expect(early.json().baseline).toBeNull()
    await reviewBuild(t.db, { buildId: a.buildId, userId: tenant.owner.id, state: 'approved' })

    // The SDK found the history itself, and asks which build it maps to.
    const baseline = await app.inject({
      method: 'POST',
      url: '/v2/baseline',
      headers: auth(),
      payload: { commits: [commitOf(0xa02), commitOf(0xa01)], name: 'default' },
    })
    expect(baseline.json().baseline).toMatchObject({ commit: commitOf(0xa01), branch: 'main' })

    const b = await argosUpload({
      commit: commitOf(0xa02),
      branch: 'feature',
      parents: [commitOf(0xa02), commitOf(0xa01)],
      shots: { home: await png('#ff0000'), about: await png('#eeeeee') },
      extra: { prNumber: 7, referenceBranch: 'main', referenceCommit: commitOf(0xa01) },
    })
    expect(b.put.statusCode).toBe(200)
    await processBuild({ db: t.db, storage }, b.buildId)
    const [row] = await t.db.select().from(schema.builds).where(eq(schema.builds.id, b.buildId))
    expect(row).toMatchObject({
      conclusion: 'changes_detected',
      baselineSource: 'sdk',
      historySource: 'sdk',
      prNumber: 7,
    })
    const diffs = await t.db
      .select()
      .from(schema.screenshotDiffs)
      .where(eq(schema.screenshotDiffs.buildId, b.buildId))
    expect(
      diffs.map((d) => `${d.name}:${d.status}`).toSorted((x, y) => x.localeCompare(y)),
    ).toEqual(['about:unchanged', 'home:changed'])
  })

  it('asks only for files the server does not have', async () => {
    const shared = await png('#abcdef')
    const first = await argosUpload({
      commit: commitOf(0xb01),
      branch: 'main',
      shots: { x: shared },
    })
    expect(first.created.screenshots).toHaveLength(1)
    const second = await createArgosBuild({
      commit: commitOf(0xb02),
      branch: 'main',
      screenshots: [{ key: sha256(shared), contentType: 'image/png' }],
    })
    expect(second.json.screenshots).toEqual([])
  })

  it('accepts screenshot names in several requests, the last one final', async () => {
    const [x, y] = [await png('#111111'), await png('#222222')]
    const { json } = await createArgosBuild({
      commit: commitOf(0xc01),
      branch: 'main',
      screenshots: [x, y].map((b) => ({ key: sha256(b), contentType: 'image/png' })),
    })
    await Promise.all(
      json.screenshots.map(
        (target: { key: string; postUrl: string; fields: Record<string, string> }) =>
          uploadTo(target, target.key === sha256(x) ? x : y),
      ),
    )
    const put = (shots: unknown[], final: boolean) =>
      app.inject({
        method: 'PUT',
        url: `/v2/builds/${json.build.id}`,
        headers: auth(),
        payload: { screenshots: shots, final },
      })
    expect((await put([{ key: sha256(x), name: 'one' }], false)).json().build.status).toBe(
      'uploading',
    )
    expect((await put([{ key: sha256(y), name: 'two' }], true)).json().build.status).toBe(
      'processing',
    )
    const names = await t.db
      .select()
      .from(schema.screenshots)
      .where(eq(schema.screenshots.buildId, json.build.id))
    expect(names.map((s) => s.name).toSorted((p, q) => p.localeCompare(q))).toEqual(['one', 'two'])
  })

  it('joins parallel shards by nonce and finishes when the last one reports the total', async () => {
    const [x, y] = [await png('#333333'), await png('#444444')]
    const first = await shard(0, x, 'left')
    expect(first.status).toBe('uploading')
    const second = await shard(1, y, 'right')
    expect(second.id).toBe(first.id)
    expect(second.status).toBe('processing')
  })

  it('refuses what it cannot compare or would have to guess', async () => {
    const bad = [
      { commit: 'nope', screenshots: [] },
      { commit: commitOf(0xe01), screenshots: [{ key: 'not-a-hash' }] },
      {
        commit: commitOf(0xe01),
        screenshots: [{ key: 'a'.repeat(64), contentType: 'image/jpeg' }],
      },
    ]
    const codes = await Promise.all(
      bad.map(async (b) => (await createArgosBuild(b)).res.statusCode),
    )
    expect(codes).toEqual([400, 400, 400])

    const { json } = await createArgosBuild({ commit: commitOf(0xe02), screenshots: [] })
    const manual = await app.inject({
      method: 'PUT',
      url: `/v2/builds/${json.build.id}`,
      headers: auth(),
      payload: { screenshots: [], parallel: true, parallelTotal: -1, final: true },
    })
    expect(manual.statusCode).toBe(400)
    expect(manual.json().error).toMatch(/manually/)
  })

  it('stores a file only if its bytes match the hash, and only for a build that asked', async () => {
    const real = await png('#555555')
    const { json } = await createArgosBuild({
      commit: commitOf(0xf01),
      screenshots: [{ key: sha256(real), contentType: 'image/png' }],
    })
    const [target] = json.screenshots
    expect((await uploadTo(target, await png('#666666'))).statusCode).toBe(422)
    const other = await createArgosBuild({ commit: commitOf(0xf02), screenshots: [] })
    const stranger = {
      postUrl: `${ORIGIN}/v2/uploads/${other.json.build.id}/${sha256(real)}`,
      fields: {},
    }
    expect((await uploadTo(stranger, real)).statusCode).toBe(404)
    expect((await uploadTo(target, real)).statusCode).toBe(204)
  })
})
