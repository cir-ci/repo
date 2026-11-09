import type { Site } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { teamPath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

export const teamSitesQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.sites(workspace, team),
    queryFn: () => getJson<Site.List>(teamPath(workspace, team, 'sites')),
  })

/** Asks for access to one site address; the answer says where to go to open it. */
export const requestSiteAccess = (label: string, returnPath: string) =>
  post<{ url: string }>('/api/site-handoff', { label, returnPath })

/** An upload's size: "12 kB" up to a megabyte, then "1.4 MB". */
export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Sets, checks and removes one site's custom domain; each refreshes the sites list. */
export function useCustomDomain(workspace: string, team: string, site: string) {
  const queryClient = useQueryClient()
  const path = teamPath(workspace, team, 'sites', site, 'domain')
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.sites(workspace, team) })
  return {
    set: useMutation({
      mutationFn: (domain: string) => send<Site.CustomDomain>('PUT', path, { domain }),
      onSuccess: refresh,
    }),
    verify: useMutation({
      mutationFn: () => post<Site.DomainCheck>(`${path}/verify`, {}),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: () => send<undefined>('DELETE', path),
      onSuccess: refresh,
    }),
  }
}
