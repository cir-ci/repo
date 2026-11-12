import type { Command } from 'commander'

import { withRuntime } from '#cli/lib/output.ts'
import { instanceProbes } from '#composition/doctor-probes.ts'
import { formatFinding, httpFetcher, runDoctor } from '#composition/doctor.ts'
import { withEffectiveSmtp } from '#composition/instance-settings.ts'

/** `circi admin doctor` */
export function addDoctorCommand(admin: Command): void {
  admin
    .command('doctor')
    .description(
      'check the deployment for what CirCI cannot enforce (storage, database, mail, disk space and the cookie scope of the domains)',
    )
    .action(() =>
      withRuntime(async (rt) => {
        let warned = false
        const config = withEffectiveSmtp(rt.config, await rt.instanceConfig.get())
        for (const f of await runDoctor(
          config,
          httpFetcher,
          rt.storage,
          instanceProbes({ db: rt.db.db, config, mailer: rt.mailer }),
        )) {
          console.log(formatFinding(f))
          warned ||= f.level === 'warn' || f.level === 'fail'
        }
        if (warned) process.exitCode = 1
      }),
    )
}
