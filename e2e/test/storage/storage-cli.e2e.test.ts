import { spawn } from 'node:child_process'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject, type CreatedProject } from '#clients/admin.ts'
import { s3Env } from '#clients/s3.ts'
import { fileRows, noisePng, parseJsonOutput, sha256Hex } from '#clients/storage.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { Repo } from '#github/git-repo.ts'
import { COMPOSE_FILE } from '#stack/paths.ts'
import { useStack } from '#stack/vitest.ts'

interface Usage {
  files: { kind: string; count: number; bytes: number }[]
  totalBytes: number
  markedForDeletion: { count: number; bytes: number }
}

// The credentials go through the container's environment; localstack is on the compose network.
const migrateArgs = (...extra: string[]) => [
  'env',
  'S3_ACCESS_KEY_ID=e2e-access',
  'S3_SECRET_ACCESS_KEY=e2e-secret',
  'circi',
  'admin',
  'storage',
  'migrate',
  ...extra,
]
const toS3 = [
  '--to',
  's3',
  '--bucket',
  'circi-e2e',
  '--endpoint',
  'http://localstack:4566',
  '--force-path-style',
]
const migrated = (out: string) => {
  const m = /Copied (\d+), already there (\d+), missing at the source (\d+), failed (\d+)/.exec(out)
  if (!m) throw new Error(`no migrate summary in: ${out}`)
  return {
    copied: Number(m[1]),
    skipped: Number(m[2]),
    missing: Number(m[3]),
    failed: Number(m[4]),
  }
}

/**
 * `circi admin storage usage|migrate` against the real stack: start on local disk, upload,
 * migrate to LocalStack, switch the server to S3, migrate back.
 */
describe('storage usage and migrate', () => {
  const ctx = useStack({ dedicated: true, setup: true, localstack: true })
  let repo: Repo
  let project: CreatedProject
  const originals = new Map<string, number>() // sha -> size of every screenshot uploaded

  const s3 = () => {
    const bucket = ctx.stack.s3
    if (!bucket) throw new Error('no bucket')
    return bucket
  }
  const upload = () => uploadOrThrow({ stack: ctx.stack, token: project.token, repo, wait: true })

  beforeAll(async () => {
    repo = await Repo.create()
    project = await createProject(ctx.setup.session, ctx.setup.workspace.slug, 'Docs')
  })
  afterAll(async () => {
    await repo.destroy()
  })

  it('usage on local disk matches what was uploaded', async () => {
    const empty = parseJsonOutput<Usage>(await ctx.stack.cli('storage', 'usage', '--json'))
    expect(empty.totalBytes).toBe(0)

    const shots: Record<string, Buffer> = {}
    for (let i = 0; i < 6; i++) shots[`page-${i}`] = await noisePng(60 + i, i + 1)
    await repo.writeShots(shots)
    await repo.commit('docs')
    await upload()
    for (const b of Object.values(shots)) originals.set(sha256Hex(b), b.length)

    const usage = parseJsonOutput<Usage>(await ctx.stack.cli('storage', 'usage', '--json'))
    const screenshots = usage.files.find((f) => f.kind === 'screenshot')
    expect(screenshots).toEqual({
      kind: 'screenshot',
      count: 6,
      bytes: [...originals.values()].reduce((a, b) => a + b, 0),
    })
    expect(usage.markedForDeletion).toEqual({ count: 0, bytes: 0 })
    const text = await ctx.stack.cli('storage', 'usage')
    expect(text).toMatch(/screenshot\s+6 files/)
    expect(text).toContain('waiting to be deleted: 0 files')
  })

  it('migrates fs to s3 with every object hash-checked, and re-running copies nothing', async () => {
    const rows = await fileRows(ctx.stack)
    expect(rows.length).toBeGreaterThanOrEqual(6)
    expect(await s3().keys()).toEqual([])
    const out = await ctx.stack.exec('circi', migrateArgs(...toS3))
    expect(migrated(out.stdout)).toEqual({ copied: rows.length, skipped: 0, missing: 0, failed: 0 })
    expect(out.stdout).toContain('Now set STORAGE_DRIVER=s3')

    expect((await s3().keys()).toSorted()).toEqual(rows.map((r) => r.storageKey).toSorted())
    for (const row of rows) {
      expect(sha256Hex(await s3().get(row.storageKey))).toBe(row.sha256)
    }
    // The server still reads from disk and is unaffected.
    const hash = [...originals.keys()][0] ?? ''
    const served = await fetch(`${ctx.stack.url}/api/files/${hash}`, {
      headers: { cookie: ctx.setup.session.cookieHeader },
    })
    expect(served.status).toBe(200)

    const again = await ctx.stack.exec('circi', migrateArgs(...toS3))
    expect(migrated(again.stdout)).toEqual({
      copied: 0,
      skipped: rows.length,
      missing: 0,
      failed: 0,
    })
  })

  it('finds a corrupt object in the target and copies it again', async () => {
    const rows = (await fileRows(ctx.stack, "status = 'verified' and kind = 'screenshot'")).slice(
      0,
      2,
    )
    const [shorter, sameSize] = rows
    if (!shorter || !sameSize) throw new Error('need two files')
    // Truncated: size differs.
    await s3().put(shorter.storageKey, Buffer.from('garbage'), 'image/png')
    // Same size, wrong bytes, but stored with S3's own checksum (as every object CirCI writes is).
    await s3().client.send(
      new PutObjectCommand({
        Bucket: s3().bucket,
        Key: sameSize.storageKey,
        Body: Buffer.alloc(sameSize.size, 7),
        ChecksumAlgorithm: 'SHA256',
        ContentType: 'image/png',
      }),
    )
    const out = await ctx.stack.exec('circi', migrateArgs(...toS3))
    expect(migrated(out.stdout)).toMatchObject({ copied: 2, failed: 0 })
    for (const row of [shorter, sameSize]) {
      expect(sha256Hex(await s3().get(row.storageKey))).toBe(row.sha256)
    }
  })

  it('is resumable: killed midway, the next run copies only what is missing', async () => {
    const shots: Record<string, Buffer> = {}
    for (let i = 0; i < 300; i++) shots[`bulk/b${i}`] = await noisePng(64, 1000 + i)
    await repo.writeShots(shots)
    await repo.commit('bulk')
    await upload()
    const total = (await fileRows(ctx.stack)).length
    const before = (await s3().keys()).length

    // Run it in the background, wait until some but not all of the new files are in the bucket,
    // then kill the process inside the container.
    const child = spawn(
      'docker',
      [
        'compose',
        '-p',
        ctx.stack.composeProject,
        '-f',
        COMPOSE_FILE,
        'exec',
        '-T',
        'circi',
        'sh',
        '-c',
        `echo $$ > /tmp/migrate.pid; exec ${migrateArgs(...toS3).join(' ')}`,
      ],
      {
        env: {
          ...process.env,
          COMPOSE_PROJECT_NAME: ctx.stack.composeProject,
          E2E_PUBLIC_URL: ctx.stack.url,
        },
        stdio: 'ignore',
      },
    )
    let present = before
    await expect
      .poll(async () => (present = (await s3().keys()).length), { interval: 50, timeout: 60_000 })
      .toBeGreaterThan(before + 3)
    await ctx.stack.exec('circi', ['sh', '-c', 'kill -9 $(cat /tmp/migrate.pid)'], {
      allowFail: true,
    })
    child.kill()
    present = (await s3().keys()).length
    expect(present).toBeLessThan(total)

    const resumed = migrated((await ctx.stack.exec('circi', migrateArgs(...toS3))).stdout)
    expect(resumed.failed).toBe(0)
    // Objects that were whole before the kill are not copied again (at most one more landed
    // between the count and the kill).
    expect(resumed.skipped).toBeGreaterThanOrEqual(present)
    expect(resumed.copied + resumed.skipped).toBe(total)
    expect((await s3().keys()).length).toBe(total)
  })

  it('after switching the server to S3 the dashboard serves the migrated files from the bucket', async () => {
    const rows = await fileRows(ctx.stack)
    await ctx.stack.reconfigure(s3Env(ctx.stack))
    const logs = await ctx.stack.logs('circi', { tail: 40 })
    expect(logs).toContain('"storage":"s3"')
    // Remove the local copies: only the bucket can serve now.
    await ctx.stack.exec('circi', ['sh', '-c', 'rm -rf /var/lib/circi/files/*'])
    for (const hash of [...originals.keys()].slice(0, 3)) {
      const res = await fetch(`${ctx.stack.url}/api/files/${hash}`, {
        headers: { cookie: ctx.setup.session.cookieHeader },
      })
      expect(res.status).toBe(200)
      expect(sha256Hex(Buffer.from(await res.arrayBuffer()))).toBe(hash)
    }
    expect(rows.length).toBeGreaterThan(300)
    // New uploads go to the bucket (presigned PUT).
    const extra = await noisePng(70, 4242)
    await repo.writeShots({ extra })
    await repo.commit('after switch')
    const up = await upload()
    expect(up.uploaded).toBe(1)
    expect(await s3().keys()).toEqual(
      expect.arrayContaining([expect.stringContaining(sha256Hex(extra))]),
    )
    originals.set(sha256Hex(extra), extra.length)
  })

  it('usage on s3 matches the bucket', async () => {
    const usage = parseJsonOutput<Usage>(await ctx.stack.cli('storage', 'usage', '--json'))
    const objects = await s3().list()
    // `usage` counts verified file rows; every one is an object of exactly that size.
    expect(usage.files.reduce((n, f) => n + f.count, 0)).toBe(objects.length)
    expect(usage.totalBytes).toBe(objects.reduce((n, o) => n + o.size, 0))
    expect(usage.files.find((f) => f.kind === 'screenshot')?.count).toBe(
      (await fileRows(ctx.stack, "kind = 'screenshot'")).length,
    )
  })

  it('migrates s3 back to local disk, every file intact', async () => {
    const rows = await fileRows(ctx.stack)
    const out = await ctx.stack.exec('circi', [
      'circi',
      'admin',
      'storage',
      'migrate',
      '--to',
      'fs',
      '--path',
      '/tmp/back',
    ])
    expect(migrated(out.stdout)).toEqual({ copied: rows.length, skipped: 0, missing: 0, failed: 0 })
    // Every file sits at its key and its content hashes to the key's sha256.
    const sums = (
      await ctx.stack.exec('circi', [
        'sh',
        '-c',
        'cd /tmp/back && find . -type f -not -path "./.tmp/*" -exec sha256sum {} +',
      ])
    ).stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.trim().split(/\s+/))
    expect(sums.length).toBe(rows.length)
    for (const [sum, path] of sums) {
      const key = (path ?? '').replace(/^\.\//, '')
      expect(key.split('/')[2]).toBe(sum)
    }
    const again = await ctx.stack.exec('circi', [
      'circi',
      'admin',
      'storage',
      'migrate',
      '--to',
      'fs',
      '--path',
      '/tmp/back',
    ])
    expect(migrated(again.stdout)).toMatchObject({ copied: 0, skipped: rows.length })
  })
})
