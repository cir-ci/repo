import type { Project } from '@circi/api'

/** The projects whose name or repository address ("acme/web-app") contains what was typed, case aside. */
export function findProjects(
  projects: ReadonlyArray<Project.Overview>,
  query: string,
): Project.Overview[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...projects]
  return projects.filter(
    (o) =>
      o.project.name.toLowerCase().includes(needle) ||
      `${o.workspace.slug}/${o.project.slug}`.toLowerCase().includes(needle),
  )
}
