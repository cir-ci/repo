import { type FetchQueryOptions, QueryClient, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import {
  cancelInvitation,
  changeMemberRole,
  domainsQuery,
  inviteMember,
  workspaceAuthQuery,
  workspaceQuery,
  workspaceSsoQuery,
  removeMember,
} from '#features/members/api.ts'
import { HttpError } from '#lib/http.ts'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { fakeFetch, restoreFetch } from '#test/support/fetch.ts'

const auth = mockAuthClient().organization

beforeEach(() => vi.resetAllMocks())
afterEach(() => restoreFetch())

const fetchQuery = <TData, TKey extends QueryKey>(
  options: FetchQueryOptions<TData, Error, TData, TKey>,
) => new QueryClient().fetchQuery(options)

describe('the read queries', () => {
  it("fetch the workspace's settings from its own paths, escaped", async () => {
    const calls = fakeFetch({
      'GET /api/workspaces/a%2Fb/auth': { settings: {}, instance: {} },
      'GET /api/workspaces/a%2Fb/domains': { domains: [] },
      'GET /api/workspaces/a%2Fb/sso': { providers: [] },
    })
    await fetchQuery(workspaceAuthQuery('a/b'))
    await fetchQuery(domainsQuery('a/b'))
    await fetchQuery(workspaceSsoQuery('a/b'))
    expect(calls.map((c) => c.path)).toEqual([
      '/api/workspaces/a%2Fb/auth',
      '/api/workspaces/a%2Fb/domains',
      '/api/workspaces/a%2Fb/sso',
    ])
  })

  it("keys each by workspace so one workspace never shows another's data", () => {
    expect(workspaceAuthQuery('a').queryKey).not.toEqual(workspaceAuthQuery('b').queryKey)
    expect(domainsQuery('a').queryKey).not.toEqual(domainsQuery('b').queryKey)
    expect(workspaceSsoQuery('a').queryKey).not.toEqual(workspaceSsoQuery('b').queryKey)
  })
})

describe('workspaceQuery', () => {
  it('returns the workspace asked for by slug', async () => {
    const workspace = { id: 'o1', name: 'Acme', members: [], invitations: [] }
    auth.getFullOrganization.mockResolvedValue({ data: workspace, error: null })
    expect(await fetchQuery(workspaceQuery('acme'))).toBe(workspace)
    expect(auth.getFullOrganization).toHaveBeenCalledWith({ query: { organizationSlug: 'acme' } })
  })

  it('is a 404 when there is no such workspace', async () => {
    auth.getFullOrganization.mockResolvedValue({ data: null, error: null })
    await expect(fetchQuery(workspaceQuery('nope'))).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
    })
  })

  it('keeps the status and message of a failure', async () => {
    auth.getFullOrganization.mockResolvedValue({
      data: null,
      error: { status: 503, message: 'Try later' },
    })
    const failure = await fetchQuery(workspaceQuery('acme')).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(HttpError)
    expect(failure).toMatchObject({ status: 503, message: 'Try later' })
  })

  it('treats a failure without a status as a server error', async () => {
    auth.getFullOrganization.mockResolvedValue({ data: null, error: {} })
    await expect(fetchQuery(workspaceQuery('acme'))).rejects.toMatchObject({
      status: 500,
      message: "Couldn't load the workspace",
    })
  })
})

describe('member operations', () => {
  it('inviteMember passes the invitation through', async () => {
    auth.inviteMember.mockResolvedValue({ data: {}, error: null })
    const input = { email: 'a@b.test', role: 'admin' as const, workspaceId: 'o1' }
    await inviteMember(input)
    expect(auth.inviteMember).toHaveBeenCalledWith({
      email: 'a@b.test',
      role: 'admin',
      organizationId: 'o1',
    })
  })

  it("inviteMember surfaces the server's message, or its own", async () => {
    auth.inviteMember.mockResolvedValueOnce({ error: { message: 'Already a member' } })
    await expect(
      inviteMember({ email: 'a@b.test', role: 'member', workspaceId: 'o1' }),
    ).rejects.toThrow('Already a member')
    auth.inviteMember.mockResolvedValueOnce({ error: {} })
    await expect(
      inviteMember({ email: 'a@b.test', role: 'member', workspaceId: 'o1' }),
    ).rejects.toThrow("Couldn't send the invitation.")
  })

  it('cancelInvitation names the invitation, and fails in words', async () => {
    auth.cancelInvitation.mockResolvedValueOnce({ data: {}, error: null })
    await cancelInvitation('i1')
    expect(auth.cancelInvitation).toHaveBeenCalledWith({ invitationId: 'i1' })
    auth.cancelInvitation.mockResolvedValueOnce({ error: {} })
    await expect(cancelInvitation('i1')).rejects.toThrow("Couldn't revoke the invitation")
  })

  it('removeMember removes by member id within the workspace', async () => {
    auth.removeMember.mockResolvedValueOnce({ data: {}, error: null })
    await removeMember({ memberId: 'm2', workspaceId: 'o1' })
    expect(auth.removeMember).toHaveBeenCalledWith({ memberIdOrEmail: 'm2', organizationId: 'o1' })
    auth.removeMember.mockResolvedValueOnce({ error: {} })
    await expect(removeMember({ memberId: 'm2', workspaceId: 'o1' })).rejects.toThrow(
      "Couldn't remove this member",
    )
  })

  it("changeMemberRole sets the role, and fails with the server's words", async () => {
    auth.updateMemberRole.mockResolvedValueOnce({ data: {}, error: null })
    await changeMemberRole({ memberId: 'm2', role: 'admin', workspaceId: 'o1' })
    expect(auth.updateMemberRole).toHaveBeenCalledWith({
      memberId: 'm2',
      role: 'admin',
      organizationId: 'o1',
    })
    auth.updateMemberRole.mockResolvedValueOnce({ error: { message: 'Not allowed' } })
    await expect(
      changeMemberRole({ memberId: 'm2', role: 'member', workspaceId: 'o1' }),
    ).rejects.toThrow('Not allowed')
    auth.updateMemberRole.mockResolvedValueOnce({ error: {} })
    await expect(
      changeMemberRole({ memberId: 'm2', role: 'member', workspaceId: 'o1' }),
    ).rejects.toThrow("Couldn't change this member's role")
  })
})
