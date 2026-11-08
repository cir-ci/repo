import { afterAll, describe, expect, it } from 'vitest'

import { sha, startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { app, acme, acmeCookie, get, buildDetail } = fx
afterAll(() => fx.close())

describe('API', () => {
  it('lists teams with their latest build', async () => {
    const p = (await get('/api/teams')).json().teams[0]
    expect(p.latestBuild).toMatchObject({
      number: 2,
      status: 'complete',
      counts: { changed: 1, unchanged: 1 },
    })
  })

  it("lists a team's builds, newest first", async () => {
    const res = await get(`/api/teams/${acme.workspaceSlug}/web`)
    expect(res.json().builds.map((b: { number: number }) => b.number)).toEqual([2, 1])
    expect((await get(`/api/teams/${acme.workspaceSlug}/nope`)).statusCode).toBe(404)
  })

  it('returns a build with its baseline and image references', async () => {
    const res = await buildDetail(acmeCookie)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.baseline).toMatchObject({ number: 1, commitSha: 'aaaa001' })
    expect(body.build).toMatchObject({
      baselineSource: 'cli',
      counts: { changed: 1, unchanged: 1, total: 2 },
    })
    const home = body.diffs.find((d: { name: string }) => d.name === 'home')
    expect(home).toMatchObject({
      status: 'changed',
      head: { width: 60, height: 40, thumbnail: expect.stringMatching(/^[0-9a-f]{64}$/) },
      base: { width: 60, height: 40 },
      diff: { width: 60, height: 40 },
    })
    expect((await get(`/api/teams/${acme.workspaceSlug}/web/builds/99`)).statusCode).toBe(404)
  })

  it('serves files by hash with permanent caching', async () => {
    const home = (await buildDetail(acmeCookie))
      .json()
      .diffs.find((d: { name: string }) => d.name === 'home')
    const res = await get(`/api/files/${home.head.sha256}`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(sha(res.rawPayload)).toBe(home.head.sha256)
    const cached = await app.inject({
      method: 'GET',
      url: `/api/files/${home.head.sha256}`,
      headers: { cookie: acmeCookie, 'if-none-match': `"${home.head.sha256}"` },
    })
    expect(cached.statusCode).toBe(304)
    expect((await get(`/api/files/${'0'.repeat(64)}`)).statusCode).toBe(404)
    expect((await get('/api/files/not-a-hash')).statusCode).toBe(404)
  })
})
