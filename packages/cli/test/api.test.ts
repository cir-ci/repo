import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiClient, ApiError, backoffDelay, NetworkError } from '#src/api.ts'

import { closedAddress } from './support/closed-port.ts'
import { FakeCirci } from './support/fake-circi.ts'

// A fresh server per test: `failUploads` counts down, so a shared one would fail whichever test
// uploads first.
let fake: FakeCirci
beforeEach(async () => {
  fake = await new FakeCirci({ servedCommit: 'abc123', failUploads: 1 }).start()
})
afterEach(async () => {
  await fake.stop()
})

const client = () => new ApiClient({ baseUrl: `${fake.url}//`, token: 'circi_secret' })
const instruction = (
  over: Partial<ApiClient.UploadInstruction> = {},
): ApiClient.UploadInstruction => ({
  sha256: 'a'.repeat(64),
  url: `${fake.url}/files/${'a'.repeat(64)}`,
  method: 'PUT',
  headers: { 'content-type': 'image/png', 'Content-Length': '3' },
  auth: 'none',
  ...over,
})

const quick = (extra: Partial<ApiClient.Options> = {}, base = '') =>
  new ApiClient({ baseUrl: base, token: 't', retryDelayMs: 1, ...extra })

/** A fetch that never answers until the request's own timeout aborts it. */
const hanging: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })

describe('ApiClient', () => {
  it('trims trailing slashes from the base URL and sends the project token', async () => {
    const info = await client().project()
    expect(info).toMatchObject({ workspace: 'acme', slug: 'web', defaultBranch: 'main' })
    const request = fake.requests.at(-1)
    expect(request?.path).toBe('/v1/project')
    expect(request?.headers.authorization).toBe('Bearer circi_secret')
  })

  it('reads which commit a branch address serves', async () => {
    await expect(client().servedCommit('storybook', 'main')).resolves.toBe('abc123')
    expect(fake.requests.at(-1)?.path).toBe('/v1/sites/served?name=storybook&branch=main')
  })

  it("turns an error response into an ApiError with the server's message and body", async () => {
    const err = await new ApiClient({ baseUrl: `${fake.url}/nope`, token: 't' })
      .project()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 404,
      message: 'no route GET /nope/v1/project',
      body: { error: 'no route GET /nope/v1/project' },
    })
  })

  it('retries a file upload after a server error, then succeeds', async () => {
    const before = fake.to('/files/').length
    await client().upload(instruction(), new Uint8Array([1, 2, 3]))
    const puts = fake.to('/files/').slice(before)
    expect(puts.map((r) => r.method)).toEqual(['PUT', 'PUT'])
    expect(puts[1]?.body).toEqual(Buffer.from([1, 2, 3]))
    // Only token uploads carry the token: this one goes straight to storage.
    expect(puts[1]?.headers.authorization).toBeUndefined()
  })

  it('sends the token on uploads that go through the API', async () => {
    await client().upload(instruction({ auth: 'token' }), new Uint8Array([1]))
    expect(fake.requests.at(-1)?.headers.authorization).toBe('Bearer circi_secret')
  })

  it('gives up on a failure that retrying cannot fix, naming the file', async () => {
    const lonely = client()
    await expect(
      lonely.upload(instruction({ url: `${fake.url}/nowhere` }), new Uint8Array([1])),
    ).rejects.toThrow(/Upload of aaaaaaaaaaaa failed: 404/)
  })

  describe('retries and timeouts', () => {
    it('resends a read after 5xx answers and dropped connections', async () => {
      const flaky = await new FakeCirci({
        failFirst: [
          { match: 'GET /v1/project', status: 502, times: 1 },
          { match: 'GET /v1/project', status: 0, times: 1 },
          { match: 'GET /v1/project', status: 503, times: 1 },
        ],
      }).start()
      try {
        await expect(quick({}, flaky.url).project()).resolves.toMatchObject({ slug: 'web' })
        expect(flaky.to('/v1/project')).toHaveLength(4)
      } finally {
        await flaky.stop()
      }
    })

    it('gives up after the allowed attempts with the last error', async () => {
      const down = await new FakeCirci({
        failFirst: [{ match: 'GET /v1/project', status: 500, times: 99 }],
      }).start()
      try {
        await expect(quick({ attempts: 3 }, down.url).project()).rejects.toMatchObject({
          status: 500,
        })
        expect(down.to('/v1/project')).toHaveLength(3)
      } finally {
        await down.stop()
      }
    })

    it("doesn't retry a client error", async () => {
      const refusing = await new FakeCirci({
        failFirst: [{ match: 'GET /v1/project', status: 401, times: 99 }],
      }).start()
      try {
        await expect(quick({}, refusing.url).project()).rejects.toMatchObject({ status: 401 })
        expect(refusing.to('/v1/project')).toHaveLength(1)
      } finally {
        await refusing.stop()
      }
    })

    it('resends a build creation with the same idempotency key, so a lost answer leaves no stray build', async () => {
      const flaky = await new FakeCirci({
        failFirst: [{ match: 'POST /v1/builds', status: 504, times: 2 }],
      }).start()
      try {
        await expect(quick({}, flaky.url).createBuild({ files: [] })).resolves.toMatchObject({
          build: { number: 7 },
        })
        const sent = flaky.to('/v1/builds')
        expect(sent).toHaveLength(3)
        const keys = new Set(sent.map((r) => r.headers['idempotency-key']))
        expect(keys.size).toBe(1)
        expect([...keys][0]).toMatch(/^[0-9a-f-]{36}$/)
      } finally {
        await flaky.stop()
      }
    })

    it('uses a new idempotency key for each build it creates', async () => {
      const api = quick({}, fake.url)
      await api.createBuild({ files: [] })
      await api.createBuild({ files: [] })
      const keys = fake.to('/v1/builds').map((r) => r.headers['idempotency-key'])
      expect(new Set(keys).size).toBe(2)
    })

    it('resends a finalize whose answer was lost', async () => {
      const flaky = await new FakeCirci({
        failFirst: [{ match: 'POST /v1/builds/b1/finalize', status: 502, times: 1 }],
      }).start()
      try {
        await expect(
          quick({}, flaky.url).finalize('b1', { screenshots: [] }),
        ).resolves.toMatchObject({ complete: true })
        expect(flaky.to('/v1/builds/b1/finalize')).toHaveLength(2)
      } finally {
        await flaky.stop()
      }
    })

    it('times out a request that never answers, with a message that names the server', async () => {
      const err = await new ApiClient({
        baseUrl: 'https://ci.example.test',
        token: 't',
        fetch: hanging,
        timeoutMs: 20,
        attempts: 1,
      })
        .project()
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NetworkError)
      expect(err).toMatchObject({
        message: "Couldn't reach https://ci.example.test (timed out)",
        code: 'TIMEOUT',
      })
    })

    it('says a refused connection plainly', async () => {
      const address = await closedAddress()
      const err = await new ApiClient({ baseUrl: address, token: 't', attempts: 1 })
        .project()
        .catch((e: unknown) => e)
      expect(err).toMatchObject({ message: `Couldn't reach ${address} (connection refused)` })
    })

    it("doesn't retry an address that isn't a URL", async () => {
      const err = await new ApiClient({ baseUrl: 'ci.acme', token: 't', retryDelayMs: 1 })
        .project()
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NetworkError)
      expect(err).toMatchObject({ message: "Couldn't reach ci.acme (not a valid URL)" })
    })
  })

  describe('backoffDelay', () => {
    it('doubles each retry, scaled by 50-100% jitter', () => {
      expect([1, 2, 3, 4].map((n) => backoffDelay(n, 100, () => 1))).toEqual([100, 200, 400, 800])
      expect([1, 2, 3].map((n) => backoffDelay(n, 100, () => 0))).toEqual([50, 100, 200])
    })
  })

  it("reports an error from the site upload with the server's message", async () => {
    const rejecting = await new FakeCirci({ siteStatus: 413 }).start()
    try {
      const err = await new ApiClient({ baseUrl: rejecting.url, token: 't' })
        .uploadSite({ name: 's' }, new Uint8Array([1]))
        .catch((e: unknown) => e)
      expect(err).toMatchObject({ status: 413, message: 'That site is too big' })
    } finally {
      await rejecting.stop()
    }
  })
})
