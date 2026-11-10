import { type Database } from '@circi/db'
import { type getTriageRotation } from '@circi/db/queries'
import { setTriageRotation } from '@circi/db/repositories'

import { autoAssignTriage } from '#src/triage/auto-assign.ts'

/** Replaces the team's triage rotation; an empty list turns it off. */
export async function replaceTriageRotation(
  db: Database,
  input: { teamId: string; memberIds: string[]; startsOn?: Date },
): Promise<getTriageRotation.Rotation> {
  return db.transaction(async (tx) => {
    const rotation = await setTriageRotation(tx, input)
    // A new rotation may put someone else on triage: automatic assignments move to them.
    await autoAssignTriage(tx, { teamId: input.teamId })
    return rotation
  })
}
