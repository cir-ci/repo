import { type Database } from '@circi/db'
import { type teamSettings } from '@circi/db/queries'
import { updateTeamSettings } from '@circi/db/repositories'

/**
 * Saves the parts of a team's settings that are given (name, default branch, thresholds,
 * retention…) and returns all of them. A bad value changes none.
 */
export async function changeTeamSettings(
  db: Database,
  teamId: string,
  patch: Partial<teamSettings.Settings>,
): Promise<teamSettings.Settings> {
  return db.transaction((tx) => updateTeamSettings(tx, teamId, patch))
}
