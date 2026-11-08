import { type Database, setTeamAppearance } from '@circi/db'

/** What a team looks like in the sidebar: its tile colour and icon. Nothing follows from it. */
export async function updateTeamAppearance(
  db: Database,
  teamId: string,
  patch: { color?: string; icon?: string | null },
): Promise<setTeamAppearance.Appearance> {
  return db.transaction((tx) => setTeamAppearance(tx, teamId, patch))
}
