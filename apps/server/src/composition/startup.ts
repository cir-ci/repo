import { setupCode } from '@circi/auth'
import type { Config } from '@circi/config'
import { countUsers, type Database, publicUrlChecklist, recordPublicUrl } from '@circi/db'
import type { Logger } from 'pino'

/** What to tell the operator once the database is ready (and migrated). */
export async function announceStartup(
  rt: { db: { db: Database }; config: Pick<Config, 'publicUrl' | 'authSecret'>; logger: Logger },
  options: { http: boolean },
): Promise<void> {
  const { db, config, logger } = rt
  const moved = await recordPublicUrl(db.db, config.publicUrl.origin)
  if (moved) {
    logger.warn(
      { from: moved.from, to: moved.to, checklist: publicUrlChecklist(moved) },
      `The dashboard address changed from ${moved.from} to ${moved.to}. Finish the address-change checklist.`,
    )
  }
  if (options.http && (await countUsers(db.db)) === 0) {
    logger.warn(
      `No accounts yet. Open ${config.publicUrl.origin} and set up CirCI with the setup code ${setupCode(config.authSecret)}`,
    )
  }
}
