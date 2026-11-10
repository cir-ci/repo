import { type Database } from '@circi/db'
import { type teamSettings } from '@circi/db/queries'
import { updateTeamSettings } from '@circi/db/repositories'

import { autoAssignTriage } from '#src/triage/auto-assign.ts'

/**
 * Saves the parts of a team's settings that are given (name, default branch, thresholds,
 * retention…) and returns all of them. A bad value changes none.
 */
export async function changeTeamSettings(
  db: Database,
  teamId: string,
  patch: Partial<teamSettings.Settings>,
): Promise<teamSettings.Settings> {
  return db.transaction(async (tx) => {
    const saved = await updateTeamSettings(tx, teamId, patch)
    // Turned on (or from inherit to a value): the items waiting go to whoever is on triage now.
    if (patch.assignTriageToOnCall !== undefined) await autoAssignTriage(tx, { teamId })
    return saved
  })
}
