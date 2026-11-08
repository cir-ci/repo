import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The auth client is the edge to better-auth: a fake stands in for it.
const auth = vi.hoisted(() => ({
  getFullOrganization: vi.fn<(arg: unknown) => Promise<unknown>>(),
  inviteMember: vi.fn<(arg: unknown) => Promise<unknown>>(),
  cancelInvitation: vi.fn<(arg: unknown) => Promise<unknown>>(),
  removeMember: vi.fn<(arg: unknown) => Promise<unknown>>(),
  updateMemberRole: vi.fn<(arg: unknown) => Promise<unknown>>(),
}))
vi.mock('../../../src/lib/auth-client.ts', () => ({ authClient: { organization: auth } }))

import {
  cancelInvitation,
  changeMemberRole,
  domainsQuery,
  inviteMember,
  orgAuthQuery,
  organizationQuery,
  orgSsoQuery,
  removeMember,
} from '../../../src/features/members/api.ts'
import { HttpError } from '../../../src/lib/http.ts'
import { fakeFetch, restoreFetch } from '../fetch-routes.ts'

beforeEach(() => vi.resetAllMocks())
afterEach(() => restoreFetch())

const fetchQuery = (options: Parameters<QueryClient['fetchQuery']>[0]) =>
  new QueryClient().fetchQuery(options)

describe('the read queries', () => {
  it('fetch the organization’s settings from its own paths, escaped', async () => {
    const calls = fakeFetch({
      'GET /api/organizations/a%2Fb/auth': { settings: {}, instance: {} },
      'GET /api/organizations/a%2Fb/domains': { domains: [] },
      'GET /api/organizations/a%2Fb/sso': { providers: [] },
    })
    await fetchQuery(orgAuthQuery('a/b'))
    await fetchQuery(domainsQuery('a/b'))
    await fetchQuery(orgSsoQuery('a/b'))
    expect(calls.map((c) => c.path)).toEqual([
      '/api/organizations/a%2Fb/auth',
      '/api/organizations/a%2Fb/domains',
      '/api/organizations/a%2Fb/sso',
    ])
  })

  it('keys each by organization so one org never shows another’s data', () => {
    expect(orgAuthQuery('a').queryKey).not.toEqual(orgAuthQuery('b').queryKey)
    expect(domainsQuery('a').queryKey).not.toEqual(domainsQuery('b').queryKey)
    expect(orgSsoQuery('a').queryKey).not.toEqual(orgSsoQuery('b').queryKey)
  })
})

describe('organizationQuery', () => {
  it('returns the organization asked for by slug', async () => {
    const org = { id: 'o1', name: 'Acme', members: [], invitations: [] }
    auth.getFullOrganization.mockResolvedValue({ data: org, error: null })
    expect(await fetchQuery(organizationQuery('acme'))).toBe(org)
    expect(auth.getFullOrganization).toHaveBeenCalledWith({ query: { organizationSlug: 'acme' } })
  })

  it('is a 404 when there is no such organization', async () => {
    auth.getFullOrganization.mockResolvedValue({ data: null, error: null })
    await expect(fetchQuery(organizationQuery('nope'))).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
    })
  })

  it('keeps the status and message of a failure', async () => {
    auth.getFullOrganization.mockResolvedValue({
      data: null,
      error: { status: 503, message: 'Try later' },
    })
    const failure = await fetchQuery(organizationQuery('acme')).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(HttpError)
    expect(failure).toMatchObject({ status: 503, message: 'Try later' })
  })

  it('treats a failure without a status as a server error', async () => {
    auth.getFullOrganization.mockResolvedValue({ data: null, error: {} })
    await expect(fetchQuery(organizationQuery('acme'))).rejects.toMatchObject({
      status: 500,
      message: 'Couldn’t load the organization',
    })
  })
})

describe('member operations', () => {
  it('inviteMember passes the invitation through', async () => {
    auth.inviteMember.mockResolvedValue({ data: {}, error: null })
    const input = { email: 'a@b.test', role: 'admin' as const, organizationId: 'o1' }
    await inviteMember(input)
    expect(auth.inviteMember).toHaveBeenCalledWith(input)
  })

  it('inviteMember surfaces the server’s message, or its own', async () => {
    auth.inviteMember.mockResolvedValueOnce({ error: { message: 'Already a member' } })
    await expect(
      inviteMember({ email: 'a@b.test', role: 'member', organizationId: 'o1' }),
    ).rejects.toThrow('Already a member')
    auth.inviteMember.mockResolvedValueOnce({ error: {} })
    await expect(
      inviteMember({ email: 'a@b.test', role: 'member', organizationId: 'o1' }),
    ).rejects.toThrow('Couldn’t send the invitation.')
  })

  it('cancelInvitation names the invitation, and fails in words', async () => {
    auth.cancelInvitation.mockResolvedValueOnce({ data: {}, error: null })
    await cancelInvitation('i1')
    expect(auth.cancelInvitation).toHaveBeenCalledWith({ invitationId: 'i1' })
    auth.cancelInvitation.mockResolvedValueOnce({ error: {} })
    await expect(cancelInvitation('i1')).rejects.toThrow('Couldn’t withdraw the invitation')
  })

  it('removeMember removes by member id within the organization', async () => {
    auth.removeMember.mockResolvedValueOnce({ data: {}, error: null })
    await removeMember({ memberId: 'm2', organizationId: 'o1' })
    expect(auth.removeMember).toHaveBeenCalledWith({ memberIdOrEmail: 'm2', organizationId: 'o1' })
    auth.removeMember.mockResolvedValueOnce({ error: {} })
    await expect(removeMember({ memberId: 'm2', organizationId: 'o1' })).rejects.toThrow(
      'Couldn’t remove this member',
    )
  })

  it('changeMemberRole sets the role, and fails with the server’s words', async () => {
    auth.updateMemberRole.mockResolvedValueOnce({ data: {}, error: null })
    await changeMemberRole({ memberId: 'm2', role: 'admin', organizationId: 'o1' })
    expect(auth.updateMemberRole).toHaveBeenCalledWith({
      memberId: 'm2',
      role: 'admin',
      organizationId: 'o1',
    })
    auth.updateMemberRole.mockResolvedValueOnce({ error: { message: 'Not allowed' } })
    await expect(
      changeMemberRole({ memberId: 'm2', role: 'member', organizationId: 'o1' }),
    ).rejects.toThrow('Not allowed')
    auth.updateMemberRole.mockResolvedValueOnce({ error: {} })
    await expect(
      changeMemberRole({ memberId: 'm2', role: 'member', organizationId: 'o1' }),
    ).rejects.toThrow('Couldn’t change this member’s role')
  })
})
