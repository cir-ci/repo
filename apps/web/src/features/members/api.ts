import type { Workspace } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { workspacePath } from '#lib/api-paths.ts'
import { authClient } from '#lib/auth-client.ts'
import { getJson, HttpError, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** Roles the page can hand out; an owner is made elsewhere. */
export type AssignableRole = 'admin' | 'member'

/** The workspace with its members and invitations (better-auth). A missing one is a 404. */
export const workspaceQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.workspace(workspace),
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization({
        query: { organizationSlug: workspace },
      })
      if (error) {
        throw new HttpError(
          error.status === 404 ? 404 : (error.status ?? 500),
          error.message ?? "Couldn't load the workspace",
        )
      }
      if (!data) throw new HttpError(404, 'Workspace not found')
      return data
    },
  })

/** Sends an invitation; the message is better-auth's, or ours when it gave none. */
export async function inviteMember(input: {
  email: string
  role: AssignableRole
  workspaceId: string
  /** Send the mail again for the pending invitation to this address (and extend its expiry). */
  resend?: boolean
}) {
  const { data, error } = await authClient.organization.inviteMember({
    email: input.email,
    role: input.role,
    organizationId: input.workspaceId,
    ...(input.resend ? { resend: true } : {}),
  })
  if (error) throw new Error(error.message ?? "Couldn't send the invitation.")
  return replacement(data)
}

/** The server marks an invitation that replaced an open one to the same address. */
function replacement(data: unknown): { replacedRole: string | null } | null {
  if (typeof data !== 'object' || data === null || Reflect.get(data, 'replaced') !== true) {
    return null
  }
  const role: unknown = Reflect.get(data, 'replacedRole')
  return { replacedRole: typeof role === 'string' ? role : null }
}

export async function cancelInvitation(invitationId: string) {
  const { error } = await authClient.organization.cancelInvitation({ invitationId })
  if (error) throw new Error("Couldn't revoke the invitation")
}

export async function removeMember(input: { memberId: string; workspaceId: string }) {
  const { error } = await authClient.organization.removeMember({
    memberIdOrEmail: input.memberId,
    organizationId: input.workspaceId,
  })
  if (error) throw new Error("Couldn't remove this member")
}

export async function changeMemberRole(input: {
  memberId: string
  role: AssignableRole
  workspaceId: string
}) {
  const { error } = await authClient.organization.updateMemberRole({
    memberId: input.memberId,
    role: input.role,
    organizationId: input.workspaceId,
  })
  if (error) throw new Error(error.message ?? "Couldn't change this member's role")
}

export const workspaceAuthQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.workspaceAuth(workspace),
    queryFn: () => getJson<Workspace.Auth>(workspacePath(workspace, 'auth')),
  })

export function useSaveWorkspaceAuth(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'save the sign-in methods' },
    mutationFn: (patch: Partial<Workspace.Auth['settings']>) =>
      send<{ settings: Workspace.Auth['settings'] }>(
        'PATCH',
        workspacePath(workspace, 'auth'),
        patch,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.workspaceAuth(workspace) }),
  })
}

export const workspaceSettingsQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.workspaceSettings(workspace),
    queryFn: () => getJson<Workspace.SettingsResponse>(workspacePath(workspace, 'settings')),
  })

export function useSaveWorkspaceSettings(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'save' },
    mutationFn: (patch: Partial<Workspace.Settings>) =>
      send<{ settings: Workspace.Settings }>('PATCH', workspacePath(workspace, 'settings'), patch),
    // Projects that inherit a setting show the workspace's value, so refresh theirs too.
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.workspaceSettings(workspace),
        // The Storage page shows the default retention beside what is used.
        keys.workspaceStorage(workspace),
        keys.allProjectSettings(),
      ),
  })
}

export const domainsQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.workspaceDomains(workspace),
    queryFn: () => getJson<{ domains: Workspace.Domain[] }>(workspacePath(workspace, 'domains')),
  })

export function useDomainActions(workspace: string) {
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: keys.workspaceDomains(workspace) })
  const base = (...rest: string[]) => workspacePath(workspace, 'domains', ...rest)
  return {
    add: useMutation({
      meta: { what: 'add the domain' },
      mutationFn: (domain: string) => post<{ domain: Workspace.Domain }>(base(), { domain }),
      onSuccess: refresh,
    }),
    verify: useMutation({
      meta: { what: 'verify the domain' },
      mutationFn: (id: string) => post<{ verified: boolean }>(base(id, 'verify'), {}),
      onSuccess: refresh,
    }),
    remove: useMutation({
      meta: { what: 'remove the domain' },
      mutationFn: (id: string) => send<undefined>('DELETE', base(id)),
      onSuccess: refresh,
    }),
  }
}

export const workspaceSsoQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.workspaceSso(workspace),
    queryFn: () => getJson<{ providers: Workspace.SsoProvider[] }>(workspacePath(workspace, 'sso')),
  })

export function useWorkspaceSso(workspace: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.workspaceSso(workspace) })
  const base = (...rest: string[]) => workspacePath(workspace, 'sso', ...rest)
  return {
    register: useMutation({
      meta: { what: 'connect the provider' },
      mutationFn: (input: { issuer: string; clientId: string; clientSecret: string }) =>
        post<{ provider: Workspace.SsoProvider }>(base(), input),
      onSuccess: refresh,
    }),
    remove: useMutation({
      meta: { what: 'remove the provider' },
      mutationFn: (providerId: string) => send<undefined>('DELETE', base(providerId)),
      onSuccess: refresh,
    }),
  }
}

/** How each member can sign in (owners and admins only: the server answers 403 to others). */
export const memberSignInQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.memberSignIn(workspace),
    queryFn: () => getJson<Workspace.MembersSignIn>(workspacePath(workspace, 'members', 'sign-in')),
  })
