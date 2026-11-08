import { addMember, createUser } from '@circi/auth'
import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '../../../support/dashboard-fixture.ts'
import { ORIGIN, signIn } from '../../../support/helpers.ts'

const fx = await startDashboard()
const { app, db, auth, acme, acmeCookie, get, buildDetail } = fx
afterAll(() => fx.close())

describe('a member who is removed from an organization', () => {
  it('loses every read at once, though their session stays valid', async () => {
    const password = 'lou-password-long-enough'
    const lou = await createUser(auth, { email: 'lou@acme.test', name: 'Lou', password })
    await addMember(auth, db, { orgSlug: acme.orgSlug, email: lou.email, role: 'member' })
    const louCookie = await signIn(app, lou.email, password)

    const detail = (await buildDetail(acmeCookie)).json()
    const home = detail.diffs.find((d: { name: string }) => d.name === 'home')
    const org = acme.orgSlug
    const reads = [
      `/api/projects/${org}/web`,
      `/api/projects/${org}/web/builds/2`,
      `/api/projects/${org}/web/settings`,
      `/api/projects/${org}/web/sites`,
      `/api/projects/${org}/web/flaky`,
      `/api/organizations/${org}/auth`,
      `/api/files/${home.head.sha256}`,
    ]
    const before = await Promise.all(reads.map((url) => get(url, louCookie)))
    expect(before.map((r) => r.statusCode)).toEqual(before.map(() => 200))
    expect((await get('/api/projects', louCookie)).json().projects).toHaveLength(1)

    // The owner removes them through better-auth's real endpoint, as the Members page does.
    const members = await app.inject({
      method: 'GET',
      url: `/api/auth/organization/get-full-organization?organizationSlug=${org}`,
      headers: { cookie: acmeCookie },
    })
    const body: { id: string; members: { id: string; user: { email: string } }[] } = members.json()
    const seat = body.members.find((m) => m.user.email === lou.email)
    const removed = await app.inject({
      method: 'POST',
      url: '/api/auth/organization/remove-member',
      headers: { cookie: acmeCookie, origin: ORIGIN, 'content-type': 'application/json' },
      payload: { memberIdOrEmail: seat?.id, organizationId: body.id },
    })
    expect(removed.statusCode).toBe(200)

    // Same session cookie, no new sign-in: it is still a valid session...
    expect((await get('/api/auth/get-session', louCookie)).statusCode).toBe(200)
    // ...but every read is "not found", and none carries the project's data.
    const after = await Promise.all(reads.map((url) => get(url, louCookie)))
    expect(after.map((r) => r.statusCode)).toEqual(after.map(() => 404))
    expect(after.map((r) => r.body).join('')).not.toContain('"web"')
    expect((await get('/api/projects', louCookie)).json().projects).toEqual([])
    const roster = await get(
      `/api/auth/organization/get-full-organization?organizationSlug=${org}`,
      louCookie,
    )
    expect(roster.statusCode).toBeGreaterThanOrEqual(400)
    expect(roster.body).not.toContain('owner')
    // The owner is unaffected.
    expect((await get(reads[0] ?? '', acmeCookie)).statusCode).toBe(200)
  })
})
