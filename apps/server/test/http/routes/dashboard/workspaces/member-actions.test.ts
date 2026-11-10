import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie } = fx
afterAll(() => fx.close())

const member = await fx.addMember('member')
const other = await fx.addMember('member')

async function workspaceId(): Promise<string> {
  const res = await fx.get(
    `/api/auth/organization/get-full-organization?organizationSlug=${acme.workspaceSlug}`,
  )
  return res.json().id
}

describe('member actions through better-auth', () => {
  it('answers 403, not 401, when a plain member removes someone', async () => {
    const roster = await fx.get(
      `/api/auth/organization/get-full-organization?organizationSlug=${acme.workspaceSlug}`,
    )
    const seat = roster
      .json()
      .members.find((m: { role: string; user: { id: string } }) => m.role === 'member')
    const res = await other.send('POST', '/api/auth/organization/remove-member', {
      memberIdOrEmail: seat.id,
      organizationId: await workspaceId(),
    })
    expect(res.statusCode).toBe(403)
  })

  it('still answers 401 with no session', async () => {
    const res = await member.anonymous.send('POST', '/api/auth/organization/remove-member', {
      memberIdOrEmail: 'x@acme.test',
      organizationId: await workspaceId(),
    })
    expect(res.statusCode).toBe(401)
  })
})

const invite = async (email: string, role: string, extra: object = {}) =>
  fx.app.inject({
    method: 'POST',
    url: '/api/auth/organization/invite-member',
    headers: {
      cookie: acmeCookie,
      origin: 'https://ci.acme.io',
      'content-type': 'application/json',
    },
    payload: { email, role, organizationId: await workspaceId(), ...extra },
  })

describe('inviting an address again', () => {
  it('says it replaced the earlier invitation, whatever the letter case', async () => {
    const first = await invite('Newcomer@Acme.test', 'member')
    expect(first.statusCode).toBe(200)
    expect(first.json().replaced).toBeUndefined()

    const second = await invite('newcomer@acme.TEST', 'admin')
    expect(second.statusCode).toBe(200)
    expect(second.json()).toMatchObject({
      email: 'newcomer@acme.test',
      role: 'admin',
      replaced: true,
      replacedRole: 'member',
    })
    expect(second.json().id).not.toBe(first.json().id)

    // One invitation per address: the first link is dead, the second lives.
    const roster = await fx.get(
      `/api/auth/organization/get-full-organization?organizationSlug=${acme.workspaceSlug}`,
    )
    const open = roster
      .json()
      .invitations.filter(
        (i: { email: string; status: string }) =>
          i.email === 'newcomer@acme.test' && i.status === 'pending',
      )
    expect(open.map((i: { id: string }) => i.id)).toEqual([second.json().id])
  })

  it('does not call a resend a replacement', async () => {
    const first = await invite('again@acme.test', 'member')
    const resent = await invite('again@acme.test', 'member', { resend: true })
    expect(resent.json().id).toBe(first.json().id)
    expect(resent.json().replaced).toBeUndefined()
  })
})

describe('an admin removing an owner', () => {
  it('is refused with 403 and says only owners can do it', async () => {
    const admin = await fx.addMember('admin')
    const roster = await fx.get(
      `/api/auth/organization/get-full-organization?organizationSlug=${acme.workspaceSlug}`,
    )
    const owner = roster.json().members.find((m: { role: string }) => m.role === 'owner')
    const res = await admin.send('POST', '/api/auth/organization/remove-member', {
      memberIdOrEmail: owner.id,
      organizationId: await workspaceId(),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toBe('Only owners can remove an owner.')
  })
})
