import { describe, expect, it } from 'vitest'

import { apiMessage, createHttpClient, type HttpFailure, parseJsonSafely } from '#src/http.ts'

interface Seen {
  url: string
  init: RequestInit
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = []
  const fetchFake: typeof fetch = async (input, init) => {
    seen.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} })
    return respond()
  }
  return { seen, fetch: fetchFake }
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, ...init })

class TestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const hang: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })

const down: typeof fetch = () => Promise.reject(new TypeError('connection refused'))

const fail = ({
  status,
  data,
  method,
  path,
}: Parameters<Parameters<typeof makeClient>[0]['fail']>[0]) =>
  new TestError(status, `${method} ${path}: ${apiMessage(data, status, 'message')}`)

function makeClient(
  options: Pick<Parameters<typeof createHttpClient>[0], 'fail'> &
    Partial<Parameters<typeof createHttpClient>[0]>,
) {
  return createHttpClient({ baseUrl: 'https://host.test/api', ...options })
}

describe('createHttpClient', () => {
  it('joins the base URL and sends the default user agent, client and request headers', async () => {
    const f = fakeFetch(() => json({ ok: true }))
    const client = makeClient({ fetch: f.fetch, headers: { accept: 'x/y' }, fail })
    const res = await client.request('GET', '/things', { headers: { authorization: 'Bearer t' } })
    expect(res).toMatchObject({ status: 200, data: { ok: true } })
    expect(f.seen[0]?.url).toBe('https://host.test/api/things')
    expect(f.seen[0]?.init.headers).toEqual({
      'user-agent': 'CirCI',
      accept: 'x/y',
      authorization: 'Bearer t',
    })
    expect(f.seen[0]?.init.body).toBeUndefined()
  })

  it('sends a JSON body with a content-type, a form body as urlencoded', async () => {
    const f = fakeFetch(() => json({}))
    const client = makeClient({ fetch: f.fetch, fail })
    await client.request('POST', '/a', { body: { n: 1 } })
    await client.request('POST', '/b', { form: { a: 'x y' } })
    expect(f.seen[0]?.init.body).toBe('{"n":1}')
    expect(f.seen[0]?.init.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(f.seen[1]?.init.body).toBe('a=x+y')
    expect(f.seen[1]?.init.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
    })
  })

  it('keeps a content-type the caller chose', async () => {
    const f = fakeFetch(() => json({}))
    await makeClient({ fetch: f.fetch, fail }).request('POST', '/a', {
      body: {},
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    expect(f.seen[0]?.init.headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
    })
  })

  it('maps a non-2xx answer through fail, with the parsed message', async () => {
    const f = fakeFetch(() => json({ message: 'nope' }, { status: 403 }))
    const err = await makeClient({ fetch: f.fetch, fail })
      .request('GET', '/x')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TestError)
    expect(err).toMatchObject({ status: 403, message: 'GET /x: nope' })
  })

  it('gives fail the raw text, status text and headers when the error body is not JSON', async () => {
    const f = fakeFetch(
      () =>
        new Response('<html>bad gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'retry-after': '7' },
        }),
    )
    let seen: HttpFailure | undefined
    await makeClient({
      fetch: f.fetch,
      fail: (failure) => {
        seen = failure
        return new Error('failed')
      },
    })
      .request('GET', '/x')
      .catch(() => undefined)
    expect(seen).toMatchObject({
      status: 502,
      statusText: 'Bad Gateway',
      data: undefined,
      text: '<html>bad gateway</html>',
    })
    expect(seen?.headers.get('retry-after')).toBe('7')
  })

  it('answers undefined data for a success body that is empty or not JSON', async () => {
    const empty = fakeFetch(() => new Response(null, { status: 204 }))
    expect(await makeClient({ fetch: empty.fetch, fail }).request('GET', '/x')).toMatchObject({
      status: 204,
      data: undefined,
    })
    const html = fakeFetch(() => new Response('<html>', { status: 200 }))
    expect(
      (await makeClient({ fetch: html.fetch, fail }).request('GET', '/x')).data,
    ).toBeUndefined()
  })

  it('times out a request that never answers, and passes no signal when the timeout is 0', async () => {
    const slow = makeClient({ fetch: hang, timeoutMs: 20, fail })
    await expect(slow.request('GET', '/x')).rejects.toMatchObject({ name: 'TimeoutError' })

    const f = fakeFetch(() => json({}))
    await makeClient({ fetch: f.fetch, timeoutMs: 0, fail }).request('GET', '/x')
    expect(f.seen[0]?.init.signal).toBeUndefined()
    await makeClient({ fetch: f.fetch, fail }).request('GET', '/x')
    expect(f.seen[1]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('lets a request override the client timeout', async () => {
    const f = fakeFetch(() => json({}))
    await makeClient({ fetch: f.fetch, timeoutMs: 0, fail }).request('GET', '/x', {
      timeoutMs: 1000,
    })
    expect(f.seen[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('rethrows a network failure, or maps it with unreachable', async () => {
    await expect(makeClient({ fetch: down, fail }).request('GET', '/x')).rejects.toThrow(
      'connection refused',
    )
    const mapped = makeClient({
      fetch: down,
      fail,
      unreachable: (err) => new TestError(0, `unreachable: ${String(err)}`),
    })
    await expect(mapped.request('GET', '/x')).rejects.toMatchObject({ status: 0 })
  })
})

describe('helpers', () => {
  it('parseJsonSafely returns undefined for empty or invalid text', () => {
    expect(parseJsonSafely('')).toBeUndefined()
    expect(parseJsonSafely('{')).toBeUndefined()
    expect(parseJsonSafely('{"a":1}')).toEqual({ a: 1 })
  })

  it('apiMessage takes the first string key, else HTTP <status>', () => {
    expect(apiMessage({ error: 'e' }, 500, 'message', 'error')).toBe('e')
    expect(apiMessage({ message: 1 }, 500, 'message')).toBe('HTTP 500')
    expect(apiMessage(undefined, 404, 'message')).toBe('HTTP 404')
  })
})
