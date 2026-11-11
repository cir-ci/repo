import { useQuery } from '@tanstack/react-query'

import { projectsQuery } from './api/index.ts'

/**
 * Display names for the breadcrumb of a page that only knows slugs (from the URL). They come from
 * the projects list the sidebar already loaded; until it arrives (or for a workspace with no projects)
 * the slug stands in.
 */
export function useCrumbNames(workspace: string, project?: string) {
  const { data } = useQuery(projectsQuery())
  const found = data?.projects.find(
    (t) => t.workspace.slug === workspace && (project === undefined || t.project.slug === project),
  )
  return {
    workspace: { slug: workspace, name: found?.workspace.name ?? workspace },
    ...(project === undefined
      ? {}
      : { project: { slug: project, name: found?.project.name ?? project } }),
  }
}
