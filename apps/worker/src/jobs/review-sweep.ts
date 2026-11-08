import type { Database } from '@circi/db'
import { notifyOverdueReviews } from '@circi/services'

/**
 * The periodic review sweep: tells reviewers about requests that ran past their due time. The
 * rules (and "once per request") live in `notifyOverdueReviews`; this is only the entry point the
 * runner calls on a timer. Returns how many reviewers were told.
 */
export async function reviewSweep(deps: { db: Database; now?: Date }): Promise<number> {
  return notifyOverdueReviews(deps.db, deps.now ? { now: deps.now } : {})
}
