import { useQueries, useQuery } from '@tanstack/react-query'

import { type YourTeam, yourTeams } from '#app/shell-model.ts'
import { teamsQuery } from '#features/teams/api/index.ts'

import { sidebarQuery } from './api.ts'

/**
 * Your teams in every workspace, pinned first (the phone's Teams tab and sheet). The list is
 * there once the overview is; pins and triage counts follow as each workspace's sidebar model
 * loads (the sidebar's own cache, so they are usually already there).
 */
export function useYourTeams(): YourTeam[] {
  const { data: overview } = useQuery(teamsQuery())
  const slugs = [...new Set(overview?.teams.map((t) => t.workspace.slug))]
  const sidebars = useQueries({
    queries: slugs.map((slug) => sidebarQuery(slug)),
    combine: (results) => Object.fromEntries(slugs.map((slug, i) => [slug, results[i]?.data])),
  })
  return yourTeams(overview?.teams, sidebars)
}
