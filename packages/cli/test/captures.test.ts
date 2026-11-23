import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { uploadCaptures, uploadSiteAfter, writeCapture } from '#src/captures.ts'
import type { uploadSite } from '#src/site.ts'
import type { upload } from '#src/upload.ts'

const ok = { exitCode: 0 } as const
const review = async () => ({ exitCode: 1 }) as const
const down = async (): Promise<never> => {
  throw new Error('server down')
}

/** Runs the helper with a fake upload; returns what it did. */
async function run(
  options: Partial<uploadCaptures.Options> = {},
  reply: () => Promise<Pick<upload.Result, 'exitCode'>> = async () => ok,
) {
  const lines: string[] = []
  const calls: upload.Options[] = []
  const result = await uploadCaptures({
    dir: '/shots',
    defaultName: 'tool',
    apiUrl: 'https://ci.acme.io',
    token: 'circi_t',
    env: {},
    log: (line) => void lines.push(line),
    uploadImpl: async (o) => {
      calls.push(o)
      return reply()
    },
    ...options,
  })
  return { result, lines, calls }
}

describe('uploadCaptures', () => {
  it('uploads the folder as a build named by the option, else by the tool', async () => {
    const named = await run({ name: 'mine', shard: { index: 1, total: 3 } })
    expect(named.result).toEqual({ status: 'uploaded', exitCode: 0 })
    expect(named.calls[0]).toMatchObject({
      dir: '/shots',
      apiUrl: 'https://ci.acme.io',
      token: 'circi_t',
      name: 'mine',
      wait: false,
      shard: { index: 1, total: 3 },
    })
    expect((await run()).calls[0]).toMatchObject({ name: 'tool' })
  })

  it('takes the address and token from the environment when the options have none', async () => {
    const { calls } = await run({
      apiUrl: undefined,
      token: undefined,
      env: { CIRCI_API_URL: 'https://e', CIRCI_TOKEN: 't' },
    })
    expect(calls[0]).toMatchObject({ apiUrl: 'https://e', token: 't' })
  })

  it('says so and uploads nothing without an address or without a token', async () => {
    const runs = await Promise.all([run({ apiUrl: undefined }), run({ token: undefined })])
    for (const { result, lines, calls } of runs) {
      expect(result).toEqual({ status: 'skipped', exitCode: 0 })
      expect(lines).toEqual([
        '[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots',
      ])
      expect(calls).toHaveLength(0)
    }
  })

  it('looks for captures only once there are credentials, and sends nothing when there are none', async () => {
    let looked = 0
    const isEmpty = async () => {
      looked += 1
      return true
    }
    await run({ apiUrl: undefined, isEmpty })
    expect(looked).toBe(0)
    const { result, lines, calls } = await run({ isEmpty })
    expect(result).toEqual({ status: 'empty', exitCode: 0 })
    expect(lines).toEqual(['[circi] no screenshots found, nothing to upload'])
    expect(calls).toHaveLength(0)
  })

  it('still reports an empty shard, so the parallel build is not left waiting for it', async () => {
    const { result, lines, calls } = await run({
      isEmpty: async () => true,
      shard: { index: 1, total: 2 },
    })
    expect(result).toEqual({ status: 'uploaded', exitCode: 0 })
    expect(lines).toEqual([
      '[circi] no screenshots found in this shard; reporting it so the build can complete',
    ])
    expect(calls).toHaveLength(1)
  })

  it("lets the build's result decide the exit code only with wait", async () => {
    expect((await run({}, review)).result).toEqual({ status: 'uploaded', exitCode: 0 })
    expect((await run({ wait: true }, review)).result).toEqual({ status: 'uploaded', exitCode: 1 })
    expect((await run({ wait: true })).result.exitCode).toBe(0)
  })

  it('reports a failed upload without throwing, and fails the run only with strict', async () => {
    const quiet = await run({}, down)
    expect(quiet.result).toEqual({ status: 'failed', exitCode: 0 })
    expect(quiet.lines.join('\n')).toContain('[circi] upload failed: server down')
    // The CLI's own code for an error, unless the integration keeps an older one.
    expect((await run({ strict: true }, down)).result.exitCode).toBe(2)
    expect((await run({ strict: true, strictExitCode: 1 }, down)).result.exitCode).toBe(1)
  })
})

describe('writeCapture', () => {
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'circi-cli-capture-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes the PNG and its sidecar, making the folders', async () => {
    const file = join(root, 'a/b/shot.png')
    await writeCapture(file, Buffer.from('png'), { storyId: 's', viewport: '1280x720' })
    expect(await readFile(file, 'utf8')).toBe('png')
    expect(JSON.parse(await readFile(`${file}.json`, 'utf8'))).toEqual({
      storyId: 's',
      viewport: '1280x720',
    })
  })

  it('writes no sidecar without metadata', async () => {
    const file = join(root, 'plain.png')
    await writeCapture(file, Buffer.from('x'))
    await expect(readFile(`${file}.json`)).rejects.toThrow(/ENOENT/)
  })
})

async function site(
  options: Partial<uploadSiteAfter.Options> = {},
  reply: () => Promise<unknown> = async () => ({}),
) {
  const lines: string[] = []
  const calls: uploadSite.Options[] = []
  const result = await uploadSiteAfter({
    dir: '/site',
    name: 'vitest-report',
    kind: 'vitest-report',
    capturesUploaded: true,
    apiUrl: 'https://ci.acme.io',
    token: 'circi_t',
    env: {},
    log: (line) => void lines.push(line),
    uploadSiteImpl: async (o) => {
      calls.push(o)
      return reply()
    },
    ...options,
  })
  return { result, lines, calls }
}

const tooBig = async (): Promise<never> => {
  throw new Error('That site is too big')
}

describe('uploadSiteAfter', () => {
  it('hosts the folder under the name and kind given, with the credentials', async () => {
    const { result, calls } = await site()
    expect(result).toEqual({ status: 'uploaded', exitCode: 0 })
    expect(calls[0]).toMatchObject({
      dir: '/site',
      name: 'vitest-report',
      kind: 'vitest-report',
      apiUrl: 'https://ci.acme.io',
      token: 'circi_t',
    })
  })

  it('takes the credentials from the environment', async () => {
    const { calls } = await site({
      apiUrl: undefined,
      token: undefined,
      env: { CIRCI_API_URL: 'https://e', CIRCI_TOKEN: 't' },
    })
    expect(calls[0]).toMatchObject({ apiUrl: 'https://e', token: 't' })
  })

  it("does nothing when the screenshots weren't uploaded, without credentials, or on a later shard", async () => {
    const runs = await Promise.all([
      site({ capturesUploaded: false }),
      site({ token: undefined }),
      site({ apiUrl: undefined }),
      site({ shard: { index: 1, total: 3 } }),
    ])
    for (const { result, calls, lines } of runs) {
      expect(result).toEqual({ status: 'skipped', exitCode: 0 })
      expect(calls).toHaveLength(0)
      expect(lines).toEqual([])
    }
    expect((await site({ shard: { index: 0, total: 3 } })).calls).toHaveLength(1)
  })

  it('reports a failed site upload, and fails the run only with strict', async () => {
    const lenient = await site({}, tooBig)
    expect(lenient.result).toEqual({ status: 'failed', exitCode: 0 })
    expect(lenient.lines).toEqual(['[circi] site upload failed: That site is too big'])
    expect((await site({ strict: true }, tooBig)).result.exitCode).toBe(2)
    expect((await site({ strict: true, strictExitCode: 1 }, tooBig)).result.exitCode).toBe(1)
  })
})
