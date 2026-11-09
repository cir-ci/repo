import { getWorkspaceBySlug, instanceAuthMethods } from '@circi/db'
import { updateWorkspaceSignIn } from '@circi/services'
import type { Command } from 'commander'

import { withRuntime } from '#cli/lib/output.ts'

/** `circi admin auth enable|disable <method>` */
export function addAuthCommands(admin: Command): void {
  const auth = admin.command('auth').description('login methods of a workspace')

  for (const action of ['enable', 'disable'] as const) {
    auth
      .command(`${action} <method>`)
      .description(
        action === 'enable'
          ? 'accept a login method (email or password) in a workspace again; the way back in when it was locked down'
          : 'stop accepting a login method (email or password) in a workspace',
      )
      .requiredOption('--org <slug>', 'organization slug')
      .action((method: string, opts: { org: string }) =>
        withRuntime(async (rt) => {
          if (method !== 'email' && method !== 'password') {
            throw new Error('method must be "email" or "password"')
          }
          const workspace = await getWorkspaceBySlug(rt.db.db, opts.org)
          const value = action === 'enable'
          // This is the break-glass command, so the lockout guard doesn't apply to it.
          const settings = await updateWorkspaceSignIn(
            rt.db.db,
            workspace.id,
            method === 'email' ? { emailLoginEnabled: value } : { passwordLoginEnabled: value },
            {
              force: true,
              instance: instanceAuthMethods({
                password: rt.config.passwordLogin,
                email: rt.config.emailLogin,
                providers: rt.config.sso.map((p) => p.id),
              }),
            },
          )
          console.log(
            `${workspace.slug}: email login ${settings.emailLoginEnabled ? 'on' : 'off'}, password login ${settings.passwordLoginEnabled ? 'on' : 'off'}`,
          )
        }),
      )
  }
}
