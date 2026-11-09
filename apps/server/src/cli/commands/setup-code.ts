import { setupCode } from '@circi/auth'
import type { Command } from 'commander'

import { withRuntime } from '#cli/lib/output.ts'

/** `circi admin setup-code` */
export function addSetupCodeCommand(admin: Command): void {
  admin
    .command('setup-code')
    .description('print the code that first-run setup in the dashboard asks for')
    .action(() =>
      withRuntime((rt) => {
        console.log(setupCode(rt.config.authSecret))
        return Promise.resolve()
      }),
    )
}
