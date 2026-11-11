import type { InstanceAdmin } from '@circi/api'

/** The workspaces whose name or slug contains what was typed, case aside. */
export function findWorkspaces(
  workspaces: ReadonlyArray<InstanceAdmin.Workspace>,
  query: string,
): InstanceAdmin.Workspace[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...workspaces]
  return workspaces.filter(
    (w) => w.name.toLowerCase().includes(needle) || w.slug.toLowerCase().includes(needle),
  )
}
