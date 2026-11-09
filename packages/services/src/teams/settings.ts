import { type Database, type teamSettings, updateTeamSettings } from '@circi/db'

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
