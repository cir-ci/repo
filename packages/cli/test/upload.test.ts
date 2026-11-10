import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { pollDelay, UsageError, upload } from '#src/upload.ts'

import { FakeCirci, type FakeCirciOptions } from './support/fake-circi.ts'

let dir: string
let cwd: string
let fake: FakeCirci
// Every server a test started: a test that starts none (pollDelay) has nothing to stop.
let started: FakeCirci[] = []
let lines: string[]

beforeAll(async () => {
  // Not a git checkout, so the commit comes from the CI environment and there is no ancestry.
  cwd = await mkdtemp(join(tmpdir(), 'circi-cli-cwd-'))
  dir = join(cwd, 'shots')
  await mkdir(dir)
  await writeFile(join(dir, 'home.png'), 'one')
  await writeFile(join(dir, 'about.png'), 'two')
})
afterAll(async () => {
  await rm(cwd, { recursive: true, force: true })
})
beforeEach(() => {
  lines = []
})
afterEach(async () => {
  await Promise.all(started.map((s) => s.stop()))
  started = []
})

const env = {
  GITLAB_CI: 'true',
  CI_COMMIT_SHA: 'f'.repeat(40),
  CI_COMMIT_BRANCH: 'feature',
  CI_JOB_URL: 'https://gitlab.test/job/1',
  CIRCI_PARALLEL_NONCE: 'run-1',
}

async function run(options: Partial<upload.Options> = {}, server: FakeCirciOptions = {}) {
  fake = await new FakeCirci(server).start()
  started.push(fake)
  return upload({
    dir,
    apiUrl: fake.url,
    token: 'circi_t',
    cwd,
    env,
    fetch: false,
    pollIntervalMs: 5,
    log: (l) => void lines.push(l),
    ...options,
  })
}

describe('upload', () => {
  it('sends the CI actor as the author, and --author replaces it', async () => {
    await run({ env: { ...env, GITLAB_USER_LOGIN: 'ann', GITLAB_USER_ID: '12' } })
    expect(fake.json(fake.to('/v1/builds')[0]!)).toMatchObject({
      author: { login: 'ann', provider: 'gitlab', providerId: '12' },
    })
    await fake.stop()
    await run({ env: { ...env, GITLAB_USER_LOGIN: 'ann' }, author: ' zed ' })
    expect(fake.json(fake.to('/v1/builds')[0]!)).toMatchObject({ author: { login: 'zed' } })
  })

  it('sends the files the server asks for, finalizes, and says what happened', async () => {
    const result = await run()
    expect(result).toMatchObject({ exitCode: 0, uploaded: 1, deduplicated: 1 })
    expect(fake.to('/files/')).toHaveLength(1)

    const created = fake.json(fake.to('/v1/builds')[0]!)
    expect(created).toMatchObject({
      commitSha: 'f'.repeat(40),
      branch: 'feature',
      baseBranch: 'main',
      ancestryStatus: 'missing',
    })
    const finalized = fake.json(fake.to('/v1/builds/b1/finalize')[0]!)
    expect(finalized).toMatchObject({
      screenshots: [{ name: 'about' }, { name: 'home' }],
    })
    expect(lines.join('\n')).toContain('Build #7')
    expect(lines.join('\n')).toContain('1 uploaded, 1 already on the server')
  })

  it('resends files the server reports missing, then finalizes again', async () => {
    await run({}, { missingOnFirstFinalize: true })
    expect(fake.to('/files/')).toHaveLength(2)
    expect(fake.to('/v1/builds/b1/finalize')).toHaveLength(2)
  })

  it("sends a shard with the run's nonce", async () => {
    await run({ shard: { index: 1, total: 3 } })
    expect(fake.json(fake.to('/v1/builds')[0]!)).toMatchObject({
      parallel: { nonce: 'run-1', total: 3 },
    })
    expect(fake.json(fake.to('/v1/builds/b1/finalize')[0]!)).toMatchObject({ shardIndex: '1' })
    expect(lines.join('\n')).toContain('shard 2 of 3 uploaded')
  })

  it('refuses a malformed shard before sending anything', async () => {
    await expect(run({ shard: { index: 3, total: 3 } })).rejects.toThrow(UsageError)
    expect(fake.to('/v1/builds')).toHaveLength(0)
  })

  it('needs a nonce to tell shards apart', async () => {
    await expect(
      run({ shard: { index: 0, total: 2 }, env: { ...env, CIRCI_PARALLEL_NONCE: undefined } }),
    ).rejects.toThrow(/CIRCI_PARALLEL_NONCE/)
  })

  it('refuses a folder with no screenshots', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'circi-cli-empty-'))
    try {
      await expect(run({ dir: empty })).rejects.toThrow(/No \.png files/)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('refuses to guess the commit outside a checkout', async () => {
    await expect(run({ env: {} })).rejects.toThrow(/Could not determine the commit/)
  })

  describe('waiting for the result', () => {
    it('exits 0 when it passes after polling', async () => {
      const result = await run({ wait: true }, { outcomes: ['pending', 'pass'] })
      expect(result.exitCode).toBe(0)
      expect(fake.to('/v1/builds/b1/status')).toHaveLength(2)
      expect(lines.join('\n')).toContain('All clear: 2 changed, 1 added, 0 removed, 3 unchanged')
    })

    it('exits 1 on changes when this job is the gate, and says where to review', async () => {
      const result = await run({ wait: true, gate: 'exit-code' }, { outcomes: ['fail'] })
      expect(result.exitCode).toBe(1)
      expect(fake.to('/v1/builds/b1/status')[0]?.path).toContain('gate=exit-code')
      expect(lines.join('\n')).toContain('Review the changes at')
      expect(lines.join('\n')).toContain('https://gitlab.test/job/1')
    })

    it("exits 0 on changes when the git host's check is the gate", async () => {
      const result = await run(
        { wait: true, gate: 'status' },
        { outcomes: ['fail'], gate: 'status' },
      )
      expect(result.exitCode).toBe(0)
    })

    it('exits 2 when the result never arrives in time', async () => {
      const result = await run(
        { wait: true, waitTimeoutMs: 20, pollIntervalMs: 10 },
        { outcomes: ['pending'] },
      )
      expect(result.exitCode).toBe(2)
      expect(lines.join('\n')).toContain('timed out')
    })
  })
})

describe('pollDelay (the --wait polling schedule)', () => {
  it('starts at 500 ms, grows gently and stops at 2 s', () => {
    const schedule = Array.from({ length: 8 }, (_, attempt) => pollDelay(attempt))
    expect(schedule).toEqual([500, 750, 1125, 1688, 2000, 2000, 2000, 2000])
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1] ?? 0)
    }
  })
})
