#!/usr/bin/env node
import { Command } from 'commander'

import { ApiError } from './api.ts'
import { upload, UsageError } from './upload.ts'

// If whoever reads our output goes away (e.g. `circi upload … | head -1`), keep uploading
// quietly instead of dying halfway with EPIPE.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}

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
  .option(
    '--shard <n/total>',
    'this job uploads shard n of total of one parallel build (e.g. 2/4); processed once all arrive',
  )
  .option('--nonce <id>', 'ties the shards of one parallel build together (default: the CI run id)')
  .option(
    '--gate <mode>',
    'who blocks the merge: status (the git host check, exit 0 on unreviewed changes) or exit-code (this job); default: decided by the server',
  )
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
        gate?: string
        shard?: string
        nonce?: string
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

      if (opts.gate !== undefined && opts.gate !== 'status' && opts.gate !== 'exit-code') {
        throw new UsageError('--gate must be "status" or "exit-code"')
      }
      const shard = opts.shard ? parseShard(opts.shard, opts.nonce) : undefined
      const result = await upload({
        dir,
        apiUrl,
        token,
        name: opts.name,
        wait: opts.wait ?? false,
        ...(shard ? { shard } : {}),
        ...(opts.gate ? { gate: opts.gate } : {}),
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

/** `2/4` → the second of four jobs, 0-based internally. */
function parseShard(text: string, nonce: string | undefined) {
  const m = /^(\d+)\/(\d+)$/.exec(text.trim())
  if (!m?.[1] || !m[2]) throw new UsageError('--shard must look like 1/4')
  return { index: Number(m[1]) - 1, total: Number(m[2]), ...(nonce ? { nonce } : {}) }
}
