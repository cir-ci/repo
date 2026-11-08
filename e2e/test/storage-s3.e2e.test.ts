import { HeadObjectCommand } from '@aws-sdk/client-s3'
import type { Build } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject, type CreatedProject } from '../src/admin.ts'
import { run } from '../src/docker.ts'
import { Repo } from '../src/git-repo.ts'
import { screenshot } from '../src/images.ts'
import { fileRows, noisePng, sha256Hex } from '../src/storage.ts'
import { uploadBuild, uploadOrThrow } from '../src/upload.ts'
import { useStack } from '../src/vitest.ts'

/** S3 storage on LocalStack: uploads, dedupe, serving, failures, and what the operator sees. */
describe('S3 storage', () => {
  const ctx = useStack({ dedicated: true, storage: 's3', setup: true })
  let repo: Repo
  let project: CreatedProject

  const s3 = () => {
    const bucket = ctx.stack.s3
    if (!bucket) throw new Error('no bucket')
    return bucket
  }
  const build = (n: number) =>
    ctx.setup.session.get<Build.Detail>(
      `/api/projects/${ctx.setup.organization.slug}/${project.slug}/builds/${n}`,
    )
  const upload = (wait = true) =>
    uploadOrThrow({ stack: ctx.stack, token: project.token, repo, wait })

  beforeAll(async () => {
    repo = await Repo.create()
    project = await createProject(ctx.setup.session, ctx.setup.organization.slug, 'Shop')
  })
  afterAll(async () => {
    await repo.destroy()
  })

  it('serves a presigned-PUT upload with its content type and immutable cache headers', async () => {
    const home = await screenshot({ background: '#ffeeaa', dot: { x: 10, y: 10 } })
    await repo.writeShots({ home })
    await repo.commit('first')
    const up = await upload()
    expect(up.uploaded).toBe(1)

    const hash = sha256Hex(home)
    const key = (await s3().keys()).find((k) => k.includes(hash))
    // ab/cd/<sha256>/<generation>
    expect(key).toMatch(
      new RegExp(`^${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}/[0-9a-f-]{36}$`),
    )
    const head = await s3().client.send(
      new HeadObjectCommand({ Bucket: s3().bucket, Key: key ?? '' }),
    )
    expect(head.ContentType).toBe('image/png')
    expect(head.ContentLength).toBe(home.length)

    const url = `${ctx.stack.url}/api/files/${hash}`
    const headers = { cookie: ctx.setup.session.cookieHeader }
    const res = await fetch(url, { headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(res.headers.get('etag')).toBe(`"${hash}"`)
    expect(Buffer.from(await res.arrayBuffer()).equals(home)).toBe(true)
    const cached = await fetch(url, { headers: { ...headers, 'if-none-match': `"${hash}"` } })
    expect(cached.status).toBe(304)
    // Not for anonymous callers.
    expect((await fetch(url)).status).toBeGreaterThanOrEqual(401)
  })

  it('stores identical screenshots of different builds once', async () => {
    const a = await screenshot({ background: '#112233', dot: { x: 5, y: 5 } })
    const b = await screenshot({ background: '#332211', dot: { x: 50, y: 5 } })
    await repo.writeShots({ a, b })
    await repo.commit('second')
    const second = await upload()
    expect(second.uploaded).toBe(2)
    const afterSecond = (await s3().keys()).toSorted()
    // Same bytes again, in a new build: nothing is uploaded, nothing new appears in the bucket.
    await repo.commit('third')
    const third = await upload()
    expect(third.uploaded).toBe(0)
    expect(third.deduplicated).toBe(3)
    const keys = await s3().keys()
    expect(keys.toSorted()).toEqual(afterSecond)
    // One bucket object per verified file row (thumbnails and diffs included), and only those.
    const rows = await fileRows(ctx.stack)
    expect(keys.toSorted()).toEqual(rows.map((r) => r.storageKey).toSorted())
    expect(new Set(rows.map((r) => r.sha256)).size).toBe(rows.length)
  })

  it('takes a large image and many files in one build', async () => {
    const big = await noisePng(2200, 7)
    expect(big.length).toBeGreaterThan(10 * 1024 * 1024)
    const many: Record<string, Buffer> = {}
    for (let i = 0; i < 60; i++) {
      many[`many/s${String(i).padStart(2, '0')}`] = await screenshot({
        background: `#${(0x100000 + i * 4099).toString(16).slice(0, 6).padStart(6, '0')}`,
        dot: { x: i, y: i },
      })
    }
    await repo.writeShots({ big, ...many })
    await repo.commit('big and many')
    const up = await upload()
    expect(up.exitCode).toBeLessThanOrEqual(1)
    expect(up.uploaded).toBe(61)
    expect(up.status?.counts.total).toBe(64) // plus the three from the earlier builds
    const object = (await s3().list()).find((o) => o.key.includes(sha256Hex(big)))
    expect(object?.size).toBe(big.length)
    expect((await s3().get(object?.key ?? '')).equals(big)).toBe(true)
    // The worker made a thumbnail for the large one without choking.
    const detail = await build(up.build.number)
    expect(detail.build.status).toBe('complete')
    const res = await fetch(`${ctx.stack.url}/api/files/${sha256Hex(big)}`, {
      headers: { cookie: ctx.setup.session.cookieHeader },
    })
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(big.length)
  })

  it(
    'fails an upload clearly while S3 is down, and recovers when it is back',
    { timeout: 120_000 },
    async () => {
      const container = `${ctx.stack.project}-localstack-1`
      // Docker is sometimes slow to stop a container on a busy machine: retry, then kill.
      for (const args of [['stop', '-t', '1'], ['kill'], ['kill']]) {
        await run('docker', [...args, container], { allowFail: true })
        const state = await run('docker', ['inspect', '-f', '{{.State.Running}}', container])
        if (state.stdout.trim() === 'false') break
      }
      try {
        await repo.writeShots({
          down: await screenshot({ background: '#abcdef', dot: { x: 1, y: 2 } }),
        })
        await repo.commit('while s3 is down')
        const started = Date.now()
        const down = await uploadBuild({ stack: ctx.stack, token: project.token, repo, wait: true })
        expect(down.exitCode).toBeGreaterThan(1)
        expect(Date.now() - started).toBeLessThan(120_000)
        expect(down.stderr + down.stdout).not.toBe('')
        // The server itself stays up and says which part is broken.
        expect((await fetch(`${ctx.stack.url}/healthz`)).status).toBe(200)
        const ready = await fetch(`${ctx.stack.url}/readyz`)
        expect(ready.status).toBe(503)
        expect(await ready.json()).toMatchObject({
          checks: { storage: expect.stringMatching(/\S/) },
        })
      } finally {
        await run('docker', ['start', container])
      }
      // LocalStack keeps nothing across a restart: bring the bucket back (a real bucket would be there).
      await expect
        .poll(
          () =>
            s3()
              .ensure()
              .then(
                () => true,
                () => false,
              ),
          { timeout: 90_000 },
        )
        .toBe(true)
      await expect
        .poll(async () => (await fetch(`${ctx.stack.url}/readyz`)).status, { timeout: 30_000 })
        .toBe(200)
      await repo.writeShots({
        back: await screenshot({ background: '#fedcba', dot: { x: 3, y: 4 } }),
      })
      await repo.commit('s3 is back')
      const up = await upload()
      expect(up.uploaded).toBeGreaterThanOrEqual(1)
    },
  )
})
