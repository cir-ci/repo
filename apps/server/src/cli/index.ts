import { isAuthApiError } from '@circi/auth'
import { ConfigError } from '@circi/config'
import { ValidationError } from '@circi/core'
import { ConflictError, NotFoundError } from '@circi/db'
import { Command } from 'commander'

import { VERSION } from '../version.ts'
import { addAdminCommands } from './admin.ts'
import { type CommandLike, debugOn, describeFailure } from './lib/usage.ts'
import { addServerCommands } from './server.ts'

/** The `circi` server command: assembles the command groups and maps errors to exit codes. */
export async function runCli(argv: string[]): Promise<void> {
  const program = new Command()
    .name('circi')
    .description('CirCI server: visual regression testing, self-hosted')
    .version(VERSION)
    .option('--debug', 'print the stack trace of an unexpected error (or set DEBUG=1)')
    .showHelpAfterError()
  addServerCommands(program)
  addAdminCommands(program)
  // The command that was running, for the usage line of a bad flag.
  let running: CommandLike | undefined
  program.hook('preAction', (_program, actionCommand) => {
    running = actionCommand
  })

  try {
    await program.parseAsync(argv)
  } catch (err) {
    // Expected failures get one clean line (a bad flag also the usage); anything else keeps its
    // stack for --debug.
    const expected =
      err instanceof ConfigError ||
      err instanceof ConflictError ||
      err instanceof NotFoundError ||
      err instanceof ValidationError ||
      isAuthApiError(err)
    console.error(
      describeFailure(err, {
        expected,
        debug: debugOn(argv, process.env),
        ...(running ? { command: running } : {}),
      }),
    )
    process.exitCode = 1
  }
}
