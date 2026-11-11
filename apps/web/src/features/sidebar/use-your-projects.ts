import { useQueries, useQuery } from '@tanstack/react-query'

import { type YourProject, yourProjects } from '#app/shell-model.ts'
import { projectsQuery } from '#features/projects/api/index.ts'

import { sidebarQuery } from './api.ts'

/**
 * Your projects in every workspace, pinned first (the phone's Projects tab and sheet). The list is
 * there once the overview is; pins and triage counts follow as each workspace's sidebar model
 * loads (the sidebar's own cache, so they are usually already there).
 */
export function useYourProjects(): YourProject[] {
  const { data: overview } = useQuery(projectsQuery())
  const slugs = [...new Set(overview?.projects.map((t) => t.workspace.slug))]
  const sidebars = useQueries({
    queries: slugs.map((slug) => sidebarQuery(slug)),
    combine: (results) => Object.fromEntries(slugs.map((slug, i) => [slug, results[i]?.data])),
  })
  return yourProjects(overview?.projects, sidebars)
}
