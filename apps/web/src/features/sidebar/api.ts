import type { Sidebar } from '@circi/api'
import { queryOptions, useQuery } from '@tanstack/react-query'

import { getJson, seg } from '#lib/http.ts'

/** Refetched on focus and every minute, so the Inbox and Reviews counts stay close to true. */
export const sidebarQuery = (workspace: string) =>
  queryOptions({
    queryKey: ['sidebar', workspace],
    queryFn: () => getJson<Sidebar.Model>(`/api/workspaces/${seg(workspace)}/sidebar`),
    refetchInterval: 60_000,
  })

/** The sidebar's model for a workspace; nothing is fetched until there is one. */
export const useSidebarModel = (workspace: string | undefined) =>
  useQuery({ ...sidebarQuery(workspace ?? ''), enabled: workspace !== undefined })
