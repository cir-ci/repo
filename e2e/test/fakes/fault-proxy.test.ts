import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startFaultProxy, type FaultProxy } from '#fakes/fault-proxy.ts'
import { listen, type Listening } from '#fakes/http.ts'

describe('the fault proxy', () => {
  let upstream: Listening
  let hits: string[] = []
  let proxy: FaultProxy

  beforeAll(async () => {
    upstream = await listen((req, res) => {
      hits.push(`${req.method} ${req.url} ${String(req.headers['idempotency-key'] ?? '')}`)
      res.setHeader('content-type', 'application/json')
      res.statusCode = req.url === '/missing' ? 404 : 201
      res.end(JSON.stringify({ n: hits.length }))
    })
    proxy = await startFaultProxy(`http://127.0.0.1:${upstream.port}`)
  })
  afterAll(async () => {
    await proxy.close()
    await upstream.close()
  })

  const post = (path: string, key = 'k') =>
    fetch(`${proxy.url}${path}`, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: '{}',
    })

  it('forwards requests and answers untouched, and records them', async () => {
    proxy.reset()
    hits = []
    const ok = await post('/a')
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ n: 1 })
    expect((await post('/missing')).status).toBe(404)
    expect(hits).toEqual(['POST /a k', 'POST /missing k'])
    expect(proxy.requests.map((r) => [r.url, r.upstreamStatus, r.outcome])).toEqual([
      ['/a', 201, 201],
      ['/missing', 404, 404],
    ])
  })

  it('dropAfter lets the server handle the request and cuts the answer, once', async () => {
    proxy.reset()
    hits = []
    proxy.inject({ match: (r) => r.url === '/b', fault: { dropAfter: true } })
    await expect(post('/b', 'same-key')).rejects.toThrow('fetch failed')
    // The server did the work; the client heard nothing.
    expect(hits).toEqual(['POST /b same-key'])
    expect(proxy.requests[0]).toMatchObject({ upstreamStatus: 201, outcome: 'dropped' })
    // The rule is spent: the resend is answered.
    expect((await post('/b', 'same-key')).status).toBe(201)
    expect(hits).toHaveLength(2)
  })

  it("status answers in the server's place without forwarding, for as many times as asked", async () => {
    proxy.reset()
    hits = []
    proxy.inject({ match: (r) => r.method === 'POST', times: 2, fault: { status: 502 } })
    expect((await post('/c')).status).toBe(502)
    expect((await post('/c')).status).toBe(502)
    expect(hits).toEqual([])
    expect((await post('/c')).status).toBe(201)
    expect(proxy.requests.map((r) => r.upstreamStatus)).toEqual([undefined, undefined, 201])
  })
})
