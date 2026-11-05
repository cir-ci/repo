import { isAuthApiError } from '@circi/auth'
import { ConfigError } from '@circi/config'
import { ValidationError } from '@circi/core'
import { ConflictError, NotFoundError } from '@circi/db'
import { Command } from 'commander'

import { addAdminCommands } from './admin.ts'
import { addServerCommands } from './server.ts'

/** The `circi` server command: assembles the command groups and maps errors to exit codes. */
export async function runCli(argv: string[]): Promise<void> {
  const program = new Command()
    .name('circi')
    .description('CirCI server: visual regression testing, self-hosted')
    .showHelpAfterError()
  addServerCommands(program)
  addAdminCommands(program)

  try {
    await program.parseAsync(argv)
  } catch (err) {
    // Expected failures get one clean line; anything else keeps its stack for debugging.
    const expected =
      err instanceof ConfigError ||
      err instanceof ConflictError ||
      err instanceof NotFoundError ||
      err instanceof ValidationError ||
      isAuthApiError(err)
    console.error(expected ? `error: ${err.message}` : err)
    process.exitCode = 1
  }
}
