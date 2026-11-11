import { type Database } from '@circi/db'
import { type projectSettings } from '@circi/db/queries'
import { updateProjectSettings } from '@circi/db/repositories'

import { autoAssignTriage } from '#src/triage/auto-assign.ts'

/**
 * Saves the parts of a project's settings that are given (name, default branch, thresholds,
 * retention…) and returns all of them. A bad value changes none.
 */
export async function changeProjectSettings(
  db: Database,
  projectId: string,
  patch: Partial<projectSettings.Settings>,
): Promise<projectSettings.Settings> {
  return db.transaction(async (tx) => {
    const saved = await updateProjectSettings(tx, projectId, patch)
    // Turned on (or from inherit to a value): the items waiting go to whoever is on triage now.
    if (patch.assignTriageToOnCall !== undefined) await autoAssignTriage(tx, { projectId })
    return saved
  })
}
