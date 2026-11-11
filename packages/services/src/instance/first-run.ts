import { type Database } from '@circi/db'
import { markFirstRunSetupDone, markFirstRunSetupPending } from '@circi/db/repositories'

/**
 * First-run setup is steps in the dashboard: the account and workspace (made in one request, so
 * a half-made instance never exists), then the storage check and the first project. This notes that
 * the later steps are still to do, so a reload, or signing in again, resumes them instead of
 * opening an empty app.
 */
export async function beginFirstRunSetup(db: Database): Promise<void> {
  await db.transaction((tx) => markFirstRunSetupPending(tx))
}

/** The steps are finished or skipped. */
export async function finishFirstRunSetup(db: Database): Promise<void> {
  await db.transaction((tx) => markFirstRunSetupDone(tx))
}
