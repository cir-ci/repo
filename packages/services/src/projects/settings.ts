import { type Database } from '@circi/db'
import { type projectsettings } from '@circi/db/queries'
import { updateProjectsettings } from '@circi/db/repositories'

import { autoAssignTriage } from '#src/triage/auto-assign.ts'

/**
 * Saves the parts of a project's settings that are given (name, default branch, thresholds,
 * retention…) and returns all of them. A bad value changes none.
 */
export async function changeProjectsettings(
  db: Database,
  projectId: string,
  patch: Partial<projectsettings.Settings>,
): Promise<projectsettings.Settings> {
  return db.transaction(async (tx) => {
    const saved = await updateProjectsettings(tx, projectId, patch)
    // Turned on (or from inherit to a value): the items waiting go to whoever is on triage now.
    if (patch.assignTriageToOnCall !== undefined) await autoAssignTriage(tx, { projectId })
    return saved
  })
}
