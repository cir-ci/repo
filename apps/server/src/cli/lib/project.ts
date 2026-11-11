import { getProjectBySlugs } from '@circi/db/queries'

import type { Runtime } from '#composition/runtime.ts'

/** The project named by the `--org <slug>` (a workspace slug) and `--project <slug>` options. */
export function projectOf(rt: Runtime, workspace: string, slug: string) {
  return getProjectBySlugs(rt.db.db, { workspaceSlug: workspace, projectSlug: slug })
}
