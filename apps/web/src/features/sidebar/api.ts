import type { Sidebar } from '@circi/api'
import { queryOptions, useQuery } from '@tanstack/react-query'

import { getJson, seg } from '#lib/http.ts'

/** Refetched on focus and every minute, so the Inbox and Reviews counts stay close to true. */
export const sidebarQuery = (org: string) =>
  queryOptions({
    queryKey: ['sidebar', org],
    queryFn: () => getJson<Sidebar.Model>(`/api/orgs/${seg(org)}/sidebar`),
    refetchInterval: 60_000,
  })

/** The sidebar's model for an organization; nothing is fetched until there is one. */
export const useSidebarModel = (org: string | undefined) =>
  useQuery({ ...sidebarQuery(org ?? ''), enabled: org !== undefined })
