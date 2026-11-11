import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { app, acme, rival, acmeCookie, rivalCookie, get, buildDetail } = fx
afterAll(() => fx.close())

describe('workspace isolation', () => {
  it("lists only the signed-in user's projects", async () => {
    const mine = (await get('/api/projects', acmeCookie)).json().projects
    expect(mine.map((p: { workspace: { slug: string } }) => p.workspace.slug)).toEqual([
      acme.workspaceSlug,
    ])
    const theirs = (await get('/api/projects', rivalCookie)).json().projects
    expect(theirs.map((p: { workspace: { slug: string } }) => p.workspace.slug)).toEqual([
      rival.workspaceSlug,
    ])
    // Each is the owner of their own workspace; the role is what the workspace menu shows.
    expect(mine[0].workspace.role).toBe('owner')
    expect(theirs[0].workspace.role).toBe('owner')
  })

  it("answers “not found” for another workspace's project and builds", async () => {
    const urls = [
      `/api/projects/${acme.workspaceSlug}/web`,
      `/api/projects/${acme.workspaceSlug}/web/builds/2`,
    ]
    const asked = await Promise.all(
      urls.flatMap((url) => [get(url, rivalCookie), get(`${url}x`, rivalCookie)]),
    )
    // Real and made-up projects get the same answer, so nothing reveals what exists.
    expect(asked.map((r) => r.statusCode)).toEqual([404, 404, 404, 404])
  })

  it('serves a screenshot only to members of its workspace', async () => {
    const detail = (await buildDetail(acmeCookie)).json()
    const home = detail.diffs.find((d: { name: string }) => d.name === 'home')
    const url = `/api/files/${home.head.sha256}`
    expect((await get(url, acmeCookie)).statusCode).toBe(200)
    expect((await get(url, rivalCookie)).statusCode).toBe(404)
    expect((await get(url, '')).statusCode).toBe(401)
    // A cached copy mustn't get past a lost membership either.
    const revalidate = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: rivalCookie, 'if-none-match': `"${home.head.sha256}"` },
    })
    expect(revalidate.statusCode).toBe(404)
  })
})
