import type { Mailer } from '@circi/auth'
import type { Config } from '@circi/config'
import type { Database } from '@circi/db'
import { getMigrationStatus, pingDatabase } from '@circi/db/queries'

import type { runDoctor } from './doctor.ts'

/** What the doctor asks of the running instance: its database and its mailer. */
export function instanceProbes(input: {
  db: Database
  config: Pick<Config, 'migrationsFolder'>
  mailer?: Mailer | undefined
}): runDoctor.Probes {
  return {
    database: {
      ping: () => pingDatabase(input.db),
      migrations: () => getMigrationStatus(input.db, input.config.migrationsFolder),
    },
    ...(input.mailer ? { mailer: input.mailer } : {}),
  }
}
