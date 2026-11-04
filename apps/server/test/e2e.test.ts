import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { FsStorage } from '@circi/storage'
import { type RunningWorker, startWorker } from '@circi/worker'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { upload } from '../../../packages/cli/src/index.ts'
import { createTestDb, seedProject, type TestDb } from '../../../packages/db/test/helpers.ts'
import { buildServer } from '../src/http.ts'

/**
 * M1 end to end (PLAN §9): the real CLI uploads to a real HTTP server, the worker diffs, and
 * `--wait` reports the outcome. Only the database (PGlite) and git remote (a local path) differ
 * from production.
 */

const exec = promisify(execFile)
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}
const git = async (cwd: string, ...args: string[]) =>
  (await exec('git', args, { cwd, env: gitEnv })).stdout.trim()

let t: TestDb
let root: string
let app: FastifyInstance
let worker: RunningWorker
let apiUrl: string
let token: string

async function screenshot(path: string, dot?: { x: number; y: number }) {
  const page = sharp({ create: { width: 400, height: 300, channels: 4, background: '#f8fafc' } })
  let out = await page.png().toBuffer()
  if (dot) {
    const mark = await sharp({
      create: { width: 20, height: 20, channels: 4, background: '#2563eb' },
    })
      .png()
      .toBuffer()
    out = await sharp(out)
      .composite([{ input: mark, left: dot.x, top: dot.y }])
      .png()
      .toBuffer()
  }
  await writeFile(path, out)
}

beforeAll(async () => {
  t = await createTestDb()
  root = await mkdtemp(join(tmpdir(), 'circi-e2e-'))
  const storage = new FsStorage({ path: join(root, 'files') })
  const logger = pino({ level: 'silent' })

  // Listen first so the public origin (used in local-disk upload URLs) is the real address.
  app = buildServer({ logger, checks: [] })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  apiUrl = `http://127.0.0.1:${address.port}`
  await app.close()
  app = buildServer({ logger, checks: [], api: { db: t.db, storage, publicOrigin: apiUrl } })
  await app.listen({ host: '127.0.0.1', port: address.port })

  worker = await startWorker({ db: t.db, storage, logger, pollIntervalMs: 20 })
  ;({ token } = await seedProject(t.db))
})

afterAll(async () => {
  await worker.stop()
  await app.close()
  await t.close()
  await rm(root, { recursive: true, force: true })
})

describe('circi upload → server → worker → --wait', () => {
  it('reports no baseline on main, then a changed screenshot on a PR', async () => {
    // A repository whose "origin" is itself, so `origin/main` exists for the PR's merge-base.
    const repo = join(root, 'repo')
    const shots = join(repo, 'screenshots')
    await mkdir(shots, { recursive: true })
    await git(root, 'init', '-q', '-b', 'main', repo)
    await git(repo, 'remote', 'add', 'origin', repo)
    await screenshot(join(shots, 'home.png'))
    await screenshot(join(shots, 'login.png'), { x: 40, y: 40 })
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'first')
    const mainSha = await git(repo, 'rev-parse', 'HEAD')
    await git(repo, 'fetch', '-q', 'origin')

    const lines: string[] = []
    const common = {
      dir: shots,
      apiUrl,
      token,
      cwd: repo,
      wait: true,
      pollIntervalMs: 50,
      log: (l: string) => lines.push(l),
    }

    // 1. main: first build, everything added, auto-approved → passes.
    const first = await upload({ ...common, env: {} })
    expect(first.ci).toMatchObject({ provider: 'local', commitSha: mainSha, branch: 'main' })
    expect(first.ancestry).toEqual({ status: 'ok', mergeBaseSha: mainSha, ancestorShas: [] })
    expect(first.uploaded).toBe(2)
    expect(first.status?.outcome).toMatchObject({ state: 'pass', summary: 'Changes approved' })
    expect(first.status?.counts).toMatchObject({ added: 2, total: 2 })
    expect(first.exitCode).toBe(0)

    // 2. A PR branch moves the dot on the login page.
    await git(repo, 'checkout', '-q', '-b', 'feature')
    await screenshot(join(shots, 'login.png'), { x: 300, y: 200 })
    await git(repo, 'commit', '-q', '-am', 'move the button')
    const prSha = await git(repo, 'rev-parse', 'HEAD')

    const second = await upload({
      ...common,
      // No CIRCI_BRANCH: the branch must come from the local checkout, even for a PR.
      env: { CIRCI_PR_NUMBER: '12', CIRCI_BASE_BRANCH: 'main' },
    })
    expect(second.ci).toMatchObject({ commitSha: prSha, prNumber: 12, branch: 'feature' })
    expect(second.ancestry).toMatchObject({
      status: 'ok',
      mergeBaseSha: mainSha,
      ancestorShas: [mainSha],
    })
    // Only the changed screenshot travels; home.png is deduplicated.
    expect([second.uploaded, second.deduplicated]).toEqual([1, 1])
    expect(second.status?.counts).toMatchObject({ changed: 1, unchanged: 1, added: 0, removed: 0 })
    expect(second.status?.outcome).toMatchObject({
      state: 'fail',
      summary: 'Visual changes need review',
    })
    expect(second.exitCode).toBe(1)
    expect(lines.some((l) => l.includes(`/builds/${second.build.number}`))).toBe(true)
  })
})
