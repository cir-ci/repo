import type { Site } from '@circi/api'
import { queryOptions } from '@tanstack/react-query'

import { getJson, post, seg } from '#lib/http.ts'

export const projectSitesQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: ['project-sites', org, project],
    queryFn: () => getJson<Site.List>(`/api/projects/${seg(org)}/${seg(project)}/sites`),
  })

/** Asks for access to one site address; the answer says where to go to open it. */
export const requestSiteAccess = (label: string, returnPath: string) =>
  post<{ url: string }>('/api/site-handoff', { label, returnPath })

/** An upload's size: "12 kB" up to a megabyte, then "1.4 MB". */
export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
