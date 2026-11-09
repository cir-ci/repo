import { afterAll, describe, expect, it } from 'vitest'

import { startAccess } from '#test/support/access-fixture.ts'

const fx = await startAccess()
const { acme, people } = fx
afterAll(() => fx.close())

const team = `/team/${acme.workspaceSlug}/web`
const manage = `/manage/${acme.workspaceSlug}/web`

describe('loadTeam', () => {
  it('lets every member of the workspace through, whatever the role', async () => {
    const all = await Promise.all(
      [people.acmeOwner, people.admin, people.member].map((user) => fx.get(team, user)),
    )
    expect(all.map((r) => r.statusCode)).toEqual([200, 200, 200])
    for (const res of all) expect(res.json()).toEqual({ ok: true, team: 'web' })
  })

  it('answers someone outside the workspace exactly as for a team that does not exist', async () => {
    const madeUp = await fx.get(`/team/${acme.workspaceSlug}/nope`, people.outsider)
    const missingWorkspace = await fx.get('/team/nope/web', people.outsider)
    const outside = await Promise.all(
      [people.outsider, people.rivalOwner].map((user) => fx.get(team, user)),
    )
    for (const res of outside) {
      expect(res.statusCode).toBe(404)
      expect(res.body).toBe(madeUp.body)
      expect(res.body).toBe(missingWorkspace.body)
    }
  })

  it('answers a made-up team of a real workspace with 404 for its own members too', async () => {
    expect((await fx.get(`/team/${acme.workspaceSlug}/nope`, people.member)).statusCode).toBe(404)
  })

  it('with manage, refuses a plain member with 403 and lets owners and admins through', async () => {
    const member = await fx.get(manage, people.member)
    expect(member.statusCode).toBe(403)
    expect(member.json()).toEqual({ error: 'Only owners and admins can change this' })
    const allowed = await Promise.all(
      [people.acmeOwner, people.admin].map((user) => fx.get(manage, user)),
    )
    expect(allowed.map((r) => r.statusCode)).toEqual([200, 200])
  })

  it('with manage, still answers 404 (never 403) to someone outside the workspace', async () => {
    expect((await fx.get(manage, people.outsider)).statusCode).toBe(404)
    expect((await fx.get(manage, people.rivalOwner)).statusCode).toBe(404)
  })

  it('does not admit a session scoped to another workspace', async () => {
    const res = await fx.get(team, people.acmeOwner, { scopedTo: 'some-other-workspace-id' })
    expect(res.statusCode).toBe(404)
  })
})
