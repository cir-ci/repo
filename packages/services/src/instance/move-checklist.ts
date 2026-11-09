import { type Database } from '@circi/db'
import {
  dismissMoveChecklist as storeDismissal,
  restoreMoveChecklist as storeRestore,
} from '@circi/db/repositories'

/**
 * Hides the "Moving to …" checklist on Instance › Health for the address (`PUBLIC_URL` origin) it
 * describes. The dismissal names that address, so when `PUBLIC_URL` changes again the checklist
 * is back, with no job or reset.
 */
export async function dismissMoveChecklist(db: Database, origin: string): Promise<void> {
  await db.transaction((tx) => storeDismissal(tx, origin))
}

/** Shows the checklist again. */
export async function restoreMoveChecklist(db: Database): Promise<void> {
  await db.transaction((tx) => storeRestore(tx))
}
