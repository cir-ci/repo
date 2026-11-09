import { getTeamBySlugs } from '@circi/db/queries'

import type { Runtime } from '#composition/runtime.ts'

/** The team named by the `--org <slug>` (a workspace slug) and `--team <slug>` options. */
export function teamOf(rt: Runtime, workspace: string, slug: string) {
  return getTeamBySlugs(rt.db.db, { workspaceSlug: workspace, teamSlug: slug })
}
