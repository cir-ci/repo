import type { Site } from '@circi/api'
import { queryOptions } from '@tanstack/react-query'

import { getJson, post, seg } from '../../lib/http.ts'

export const projectSitesQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: ['project-sites', org, project],
    queryFn: () => getJson<Site.List>(`/api/projects/${seg(org)}/${seg(project)}/sites`),
  })

/** Asks for access to one site address; the answer says where to go to open it. */
export const requestSiteAccess = (label: string, returnPath: string) =>
  post<{ url: string }>('/api/site-handoff', { label, returnPath })
