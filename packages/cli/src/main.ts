#!/usr/bin/env node
import { Command } from 'commander'

import { ApiError } from './api.ts'
import { upload, UsageError } from './upload.ts'

const program = new Command()
  .name('circi')
  .description('Upload screenshots from CI to a CirCI server')
  .showHelpAfterError()

program
  .command('upload')
  .description('upload a directory of PNG screenshots as a build')
  .argument('<dir>', 'directory with .png screenshots (searched recursively)')
  .option('--name <name>', 'build name, for several kinds of builds per commit', 'default')
  .option('--wait', 'wait for the result and exit non-zero when it should block the merge')
  .option('--timeout <seconds>', 'how long --wait waits', '600')
  .option('--api-url <url>', 'CirCI address (default: CIRCI_API_URL)')
  .option('--no-fetch', "don't run git fetch to complete shallow history")
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    `
Environment:
  CIRCI_TOKEN    project CI token (required)
  CIRCI_API_URL  CirCI address, e.g. https://ci.acme.io
  CIRCI_COMMIT, CIRCI_BRANCH, CIRCI_PR_NUMBER, CIRCI_BASE_BRANCH
                 override what is detected from the CI environment

Exit codes: 0 pass, 1 visual changes block the merge (with --wait), 2 error`,
  )
  .action(
    async (
      dir: string,
      opts: {
        name: string
        wait?: boolean
        timeout: string
        apiUrl?: string
        fetch: boolean
        json?: boolean
      },
    ) => {
      const token = process.env.CIRCI_TOKEN
      const apiUrl = opts.apiUrl ?? process.env.CIRCI_API_URL
      if (!token) throw new UsageError('Set CIRCI_TOKEN to the project CI token')
      if (!apiUrl) throw new UsageError('Set CIRCI_API_URL (or --api-url) to your CirCI address')
      const timeout = Number(opts.timeout)
      if (!Number.isFinite(timeout) || timeout <= 0)
        throw new UsageError('--timeout must be a positive number of seconds')

      const result = await upload({
        dir,
        apiUrl,
        token,
        name: opts.name,
        wait: opts.wait ?? false,
        waitTimeoutMs: timeout * 1000,
        fetch: opts.fetch,
        ...(opts.json ? { log: (line: string) => console.error(line) } : {}),
      })
      if (opts.json) console.log(JSON.stringify(result, null, 2))
      process.exitCode = result.exitCode
    },
  )

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof UsageError || err instanceof ApiError) {
    console.error(`error: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exitCode = 2
})
