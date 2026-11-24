import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { ApiClient, upload } from '@circi/cli'
import { createTestDb } from '@circi/db/testing'
import { reviewBuild } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { pngBytes } from '@circi/testing'
import { startWorker } from '@circi/worker'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'

import { snapshotDb } from './support/db-snapshot.ts'
import { createTestAuth, seedTenant } from './support/helpers.ts'

/**
 * M1 end to end (PLAN §9): the real CLI uploads to a real HTTP server, the worker diffs, and
 * `--wait` reports the outcome. Only the database (the test Postgres) and git remote (a local path) differ
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

let t: createTestDb.Result
let root: string
let app: FastifyInstance
let worker: startWorker.Running
let apiUrl: string
let token: string
let ownerId: string
let reset: () => Promise<void>

async function screenshot(path: string, dot?: { x: number; y: number }) {
  const mark = dot && { ...dot, w: 20, h: 20, color: '#2563eb' }
  await writeFile(
    path,
    await pngBytes({ width: 400, height: 300, color: '#f8fafc', ...(mark ? { mark } : {}) }),
  )
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
  const betterAuth = createTestAuth(t.db)
  app = buildServer({
    logger,
    checks: [],
    api: { db: t.db, auth: betterAuth, storage, publicOrigin: apiUrl },
  })
  await app.listen({ host: '127.0.0.1', port: address.port })

  worker = await startWorker({ db: t.db, storage, logger, pollIntervalMs: 20 })
  const tenant = await seedTenant(betterAuth, t.db)
  token = tenant.token
  ownerId = tenant.owner.id
  reset = await snapshotDb(t)
})

// Every test starts with the tenant and nothing else: no builds, no baselines, no known files.
beforeEach(() => reset())

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

    // 1. main: first build, everything added. With no baseline it is never auto-approved, so it
    // waits for review and the run fails until someone approves it.
    const first = await upload({ ...common, env: {} })
    expect(first.ci).toMatchObject({ provider: 'local', commitSha: mainSha, branch: 'main' })
    expect(first.ancestry).toEqual({ status: 'ok', mergeBaseSha: mainSha, ancestorShas: [] })
    expect(first.uploaded).toBe(2)
    expect(first.status?.outcome).toMatchObject({
      state: 'fail',
      summary: 'Visual changes need review',
    })
    expect(first.status?.counts).toMatchObject({ added: 2, total: 2 })
    expect(first.exitCode).toBe(1)
    await reviewBuild(t.db, { buildId: first.build.id, userId: ownerId, state: 'approved' })

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

    // 3. The PR is rejected; re-running the CI job on the same commit (same images) stays
    // rejected: the build says so, `--wait` fails the job, and nothing was approved by itself.
    await reviewBuild(t.db, { buildId: second.build.id, userId: ownerId, state: 'rejected' })
    const rerun = await upload({
      ...common,
      env: { CIRCI_PR_NUMBER: '12', CIRCI_BASE_BRANCH: 'main' },
    })
    expect(rerun.build.number).toBeGreaterThan(second.build.number)
    expect(rerun.status?.build).toMatchObject({ status: 'complete', reviewStatus: 'rejected' })
    expect(rerun.status?.outcome).toMatchObject({ state: 'fail', summary: 'Changes rejected' })
    expect(rerun.exitCode).toBe(1)
    expect(lines.some((l) => l.startsWith('Changes rejected:'))).toBe(true)
  })

  it('joins the shards of one CI run into a single build, finished by the last one', async () => {
    const repo = join(root, 'sharded')
    const left = join(repo, 'left')
    const right = join(repo, 'right')
    await mkdir(left, { recursive: true })
    await mkdir(right, { recursive: true })
    await git(root, 'init', '-q', '-b', 'main', repo)
    await screenshot(join(left, 'home.png'))
    await screenshot(join(right, 'login.png'), { x: 10, y: 10 })
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'sharded')

    // The project already has an approved main build to compare with, so the sharded run is
    // approved automatically (a first build never is).
    const baseline = await upload({
      apiUrl,
      token,
      cwd: repo,
      fetch: false,
      pollIntervalMs: 50,
      log: () => {},
      dir: left,
      env: {},
      wait: true,
    })
    await reviewBuild(t.db, { buildId: baseline.build.id, userId: ownerId, state: 'approved' })
    await git(repo, 'commit', '-q', '--allow-empty', '-m', 'sharded run')
    const env = { GITHUB_RUN_ID: '991', GITHUB_RUN_ATTEMPT: '1' }
    const common = { apiUrl, token, cwd: repo, fetch: false, pollIntervalMs: 50, log: () => {} }

    const one = await upload({ ...common, dir: left, env, shard: { index: 0, total: 2 } })
    const stillWaiting = await new ApiClient({ baseUrl: apiUrl, token }).status(one.build.id)
    expect(stillWaiting.build.status).toBe('uploading')

    const two = await upload({
      ...common,
      dir: right,
      env,
      shard: { index: 1, total: 2 },
      wait: true,
    })
    expect(two.build.id).toBe(one.build.id)
    // Both shards' screenshots are in the one build (compared with the earlier main build).
    expect(two.status?.counts.total).toBe(2)
    expect(two.status?.build.status).toBe('complete')
    expect(two.exitCode).toBe(0)
  })
})
