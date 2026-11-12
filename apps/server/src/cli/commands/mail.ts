import type { Command } from 'commander'

import { withRuntime } from '#cli/lib/output.ts'

/** `circi admin mail test` */
export function addMailCommands(admin: Command): void {
  const mail = admin.command('mail').description('check outgoing mail')

  mail
    .command('test')
    .description('send a test mail through the configured SMTP server')
    .requiredOption('--to <email>', 'recipient')
    .action((opts: { to: string }) =>
      withRuntime(async (rt) => {
        if ((await rt.mailer.configured?.()) === false) {
          throw new Error(
            "Mail isn't set up: add a mail server in Instance settings, or set SMTP_HOST and SMTP_FROM",
          )
        }
        await rt.mailer.send({
          to: opts.to,
          subject: 'CirCI test mail',
          text: 'If you can read this, CirCI can send mail.\n',
        })
        console.log(`Sent a test mail to ${opts.to}`)
      }),
    )
}
