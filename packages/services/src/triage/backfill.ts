import { type Database } from '@circi/db'
import { getSetting } from '@circi/db/queries'
import { listProjectIds, refreshTriageProblems, setSetting } from '@circi/db/repositories'

/** Set once every project's `triage_problems` rows have been built (migration 0002 made the table empty). */
export const TRIAGE_PROBLEMS_BACKFILLED_KEY = 'triage_problems_backfilled'

/**
 * Fills `triage_problems` for projects that existed before the table did: it is derived from
 * builds by rules written in code (`findTriageProblems`), so a migration can't do it in SQL and
 * the sidebar would show 0 triage items until new activity. Runs once per database (a marker in
 * `instance_settings`); every project is refreshed under its own lock and in its own
 * transaction, so a pass that stops halfway is repeated safely and never blocks live writers.
 * Resolves to how many projects it refreshed (0 when it had already run).
 */
export async function backfillTriageProblems(db: Database): Promise<number> {
  if ((await getSetting(db, TRIAGE_PROBLEMS_BACKFILLED_KEY)) !== undefined) return 0
  const ids = await listProjectIds(db)
  for (const projectId of ids) {
    // oxlint-disable-next-line no-await-in-loop -- one project at a time keeps each lock short
    await refreshTriageProblems(db, projectId)
  }
  await setSetting(db, TRIAGE_PROBLEMS_BACKFILLED_KEY, new Date().toISOString())
  return ids.length
}
