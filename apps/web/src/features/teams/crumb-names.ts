import { useQuery } from '@tanstack/react-query'

import { teamsQuery } from './api/index.ts'

/**
 * Display names for the breadcrumb of a page that only knows slugs (from the URL). They come from
 * the teams list the sidebar already loaded; until it arrives (or for a workspace with no teams)
 * the slug stands in.
 */
export function useCrumbNames(workspace: string, team?: string) {
  const { data } = useQuery(teamsQuery())
  const found = data?.teams.find(
    (t) => t.workspace.slug === workspace && (team === undefined || t.team.slug === team),
  )
  return {
    workspace: { slug: workspace, name: found?.workspace.name ?? workspace },
    ...(team === undefined ? {} : { team: { slug: team, name: found?.team.name ?? team } }),
  }
}
