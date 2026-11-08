import type { Org } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'
import { getJson, HttpError, post, send, seg } from '#lib/http.ts'

/** Roles the page can hand out; an owner is made elsewhere. */
export type AssignableRole = 'admin' | 'member'

/** The organization with its members and invitations (better-auth). A missing one is a 404. */
export const organizationQuery = (org: string) =>
  queryOptions({
    queryKey: ['organization', org],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization({
        query: { organizationSlug: org },
      })
      if (error) {
        throw new HttpError(
          error.status === 404 ? 404 : (error.status ?? 500),
          error.message ?? 'Couldn’t load the organization',
        )
      }
      if (!data) throw new HttpError(404, 'Organization not found')
      return data
    },
  })

/** Sends an invitation; the message is better-auth's, or ours when it gave none. */
export async function inviteMember(input: {
  email: string
  role: AssignableRole
  organizationId: string
}) {
  const { error } = await authClient.organization.inviteMember(input)
  if (error) throw new Error(error.message ?? 'Couldn’t send the invitation.')
}

export async function cancelInvitation(invitationId: string) {
  const { error } = await authClient.organization.cancelInvitation({ invitationId })
  if (error) throw new Error('Couldn’t withdraw the invitation')
}

export async function removeMember(input: { memberId: string; organizationId: string }) {
  const { error } = await authClient.organization.removeMember({
    memberIdOrEmail: input.memberId,
    organizationId: input.organizationId,
  })
  if (error) throw new Error('Couldn’t remove this member')
}

export async function changeMemberRole(input: {
  memberId: string
  role: AssignableRole
  organizationId: string
}) {
  const { error } = await authClient.organization.updateMemberRole(input)
  if (error) throw new Error(error.message ?? 'Couldn’t change this member’s role')
}

export const orgAuthQuery = (org: string) =>
  queryOptions({
    queryKey: ['org-auth', org],
    queryFn: () => getJson<Org.Auth>(`/api/organizations/${seg(org)}/auth`),
  })

export function useSaveOrgAuth(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Org.Auth['settings']>) =>
      send<{ settings: Org.Auth['settings'] }>(
        'PATCH',
        `/api/organizations/${seg(org)}/auth`,
        patch,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org-auth', org] }),
  })
}

export const orgSettingsQuery = (org: string) =>
  queryOptions({
    queryKey: ['org-settings', org],
    queryFn: () => getJson<Org.SettingsResponse>(`/api/organizations/${seg(org)}/settings`),
  })

export function useSaveOrgSettings(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Org.Settings>) =>
      send<{ settings: Org.Settings }>('PATCH', `/api/organizations/${seg(org)}/settings`, patch),
    // Projects that inherit a setting show the organization's value, so refresh theirs too.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['org-settings', org] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]),
  })
}

export const domainsQuery = (org: string) =>
  queryOptions({
    queryKey: ['org-domains', org],
    queryFn: () => getJson<{ domains: Org.Domain[] }>(`/api/organizations/${seg(org)}/domains`),
  })

export function useDomainActions(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['org-domains', org] })
  const base = `/api/organizations/${seg(org)}/domains`
  return {
    add: useMutation({
      mutationFn: (domain: string) => post<{ domain: Org.Domain }>(base, { domain }),
      onSuccess: refresh,
    }),
    verify: useMutation({
      mutationFn: (id: string) => post<{ verified: boolean }>(`${base}/${seg(id)}/verify`, {}),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => send<undefined>('DELETE', `${base}/${seg(id)}`),
      onSuccess: refresh,
    }),
  }
}

export const orgSsoQuery = (org: string) =>
  queryOptions({
    queryKey: ['org-sso', org],
    queryFn: () => getJson<{ providers: Org.SsoProvider[] }>(`/api/organizations/${seg(org)}/sso`),
  })

export function useOrgSso(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['org-sso', org] })
  const base = `/api/organizations/${seg(org)}/sso`
  return {
    register: useMutation({
      mutationFn: (input: { issuer: string; clientId: string; clientSecret: string }) =>
        post<{ provider: Org.SsoProvider }>(base, input),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (providerId: string) => send<undefined>('DELETE', `${base}/${seg(providerId)}`),
      onSuccess: refresh,
    }),
  }
}
