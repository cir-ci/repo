import type { Org } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '../../lib/http.ts'

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
