import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiClient, ApiError, type UploadInstruction } from '../src/api.ts'
import { FakeCirci } from './support/fake-circi.ts'

const fake = new FakeCirci({ servedCommit: 'abc123', failUploads: 1 })
beforeAll(async () => {
  await fake.start()
})
afterAll(async () => {
  await fake.stop()
})

const client = () => new ApiClient({ baseUrl: `${fake.url}//`, token: 'circi_secret' })
const instruction = (over: Partial<UploadInstruction> = {}): UploadInstruction => ({
  sha256: 'a'.repeat(64),
  url: `${fake.url}/files/${'a'.repeat(64)}`,
  method: 'PUT',
  headers: { 'content-type': 'image/png', 'Content-Length': '3' },
  auth: 'none',
  ...over,
})

describe('ApiClient', () => {
  it('trims trailing slashes from the base URL and sends the project token', async () => {
    const info = await client().project()
    expect(info).toMatchObject({ org: 'acme', slug: 'web', defaultBranch: 'main' })
    const request = fake.requests.at(-1)
    expect(request?.path).toBe('/v1/project')
    expect(request?.headers.authorization).toBe('Bearer circi_secret')
  })

  it('reads which commit a branch address serves', async () => {
    await expect(client().servedCommit('storybook', 'main')).resolves.toBe('abc123')
    expect(fake.requests.at(-1)?.path).toBe('/v1/sites/served?name=storybook&branch=main')
  })

  it('turns an error response into an ApiError with the server’s message and body', async () => {
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

  it('reports an error from the site upload with the server’s message', async () => {
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
