import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpError, request, send } from '#lib/http.ts'

function stubFetch(response: Response) {
  const fetcher = vi.fn<typeof fetch>(async () => response.clone())
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())

describe('request', () => {
  it('returns parsed JSON on success', async () => {
    stubFetch(Response.json({ ok: 1 }))
    expect(await request('/api/x')).toEqual({ ok: 1 })
  })

  it('returns undefined for a 204', async () => {
    stubFetch(new Response(null, { status: 204 }))
    expect(await request('/api/x', { method: 'DELETE' })).toBeUndefined()
  })

  it("turns the server's error message into an HttpError with the status", async () => {
    stubFetch(Response.json({ error: 'Project not found' }, { status: 404 }))
    await expect(request('/api/x')).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
      message: 'Project not found',
    })
  })

  it('falls back to the status line when the body is not JSON', async () => {
    stubFetch(new Response('<html>bad gateway</html>', { status: 502 }))
    const err = await request('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 502, message: 'HTTP 502' })
  })

  it('sends JSON bodies with a content type, and none without a body', async () => {
    const fetcher = stubFetch(Response.json({}))
    await send('PATCH', '/api/x', { a: 1 })
    await send('DELETE', '/api/y')
    const [patch, del] = fetcher.mock.calls.map(([, init]) => init ?? {})
    expect(patch?.body).toBe('{"a":1}')
    expect(new Headers(patch?.headers).get('content-type')).toBe('application/json')
    expect(del?.body).toBeUndefined()
    expect(new Headers(del?.headers).get('content-type')).toBeNull()
  })
})
