import { createUser, generatePassword, setUserPassword } from '@circi/auth'
import type { Command } from 'commander'

import { printJson, printPassword, withRuntime } from '#cli/lib/output.ts'

/** `circi admin user create|set-password` */
export function addUserCommands(admin: Command): void {
  const user = admin.command('user').description('manage accounts')

  user
    .command('create')
    .description('create an account (there is no self sign-up)')
    .requiredOption('--email <email>', 'sign-in email')
    .requiredOption('--name <name>', 'display name')
    .option('--password <password>', 'at least 12 characters (default: generate one and print it)')
    .option('--instance-admin', 'make this person an instance admin')
    .option('--json', 'print JSON (includes a generated password)')
    .action(
      (opts: {
        email: string
        name: string
        password?: string
        instanceAdmin?: boolean
        json?: boolean
      }) =>
        withRuntime(async (rt) => {
          const password = opts.password ?? generatePassword()
          const created = await createUser(rt.auth, {
            email: opts.email,
            name: opts.name,
            password,
            ...(opts.instanceAdmin ? { instanceAdmin: true } : {}),
          })
          const generated = opts.password === undefined
          if (opts.json) {
            return printJson({
              id: created.id,
              email: created.email,
              ...(generated ? { password } : {}),
            })
          }
          console.log(`Created account ${created.email}`)
          if (generated) printPassword(password)
        }),
    )

  user
    .command('set-password')
    .description('set a new password for an account')
    .requiredOption('--email <email>', 'account email')
    .option('--password <password>', 'at least 12 characters (default: generate one and print it)')
    .option('--json', 'print JSON (includes a generated password)')
    .action((opts: { email: string; password?: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const password = opts.password ?? generatePassword()
        await setUserPassword(rt.auth, rt.db.db, { email: opts.email, password })
        const generated = opts.password === undefined
        if (opts.json) return printJson(generated ? { password } : {})
        console.log(`Changed the password for ${opts.email}`)
        if (generated) printPassword(password)
      }),
    )
}
