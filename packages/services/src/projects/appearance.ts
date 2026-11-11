import { type Database } from '@circi/db'
import { setProjectAppearance } from '@circi/db/repositories'

/** What a project looks like in the sidebar: its tile colour and icon. Nothing follows from it. */
export async function updateProjectAppearance(
  db: Database,
  projectId: string,
  patch: { color?: string; icon?: string | null },
): Promise<setProjectAppearance.Appearance> {
  return db.transaction((tx) => setProjectAppearance(tx, projectId, patch))
}
