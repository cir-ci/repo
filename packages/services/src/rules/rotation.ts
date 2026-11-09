import { type Database } from '@circi/db'
import { type getTriageRotation } from '@circi/db/queries'
import { setTriageRotation } from '@circi/db/repositories'

/** Replaces the team's triage rotation; an empty list turns it off. */
export async function replaceTriageRotation(
  db: Database,
  input: { teamId: string; memberIds: string[]; startsOn?: Date },
): Promise<getTriageRotation.Rotation> {
  return db.transaction((tx) => setTriageRotation(tx, input))
}
