#!/usr/bin/env node
import { Command, Option } from 'commander'

import pkg from '../package.json' with { type: 'json' }
import { debugOn, ignoreBrokenPipe, reportError, UsageError } from './errors.ts'
import { shardFlag } from './shard.ts'
import { uploadSite } from './site.ts'
import { upload } from './upload.ts'

/** `--api-url`, read from CIRCI_API_URL when not given (commander shows that in `--help`). */
const apiUrlOption = () => new Option('--api-url <url>', 'CirCI address').env('CIRCI_API_URL')

/** The CirCI address and CI token every command needs. */
function connection(apiUrl: string | undefined): { apiUrl: string; token: string } {
  const token = process.env.CIRCI_TOKEN
  if (!token) throw new UsageError('Set CIRCI_TOKEN to the project CI token')
  if (!apiUrl) throw new UsageError('Set CIRCI_API_URL (or --api-url) to your CirCI address')
  return { apiUrl, token }
}

ignoreBrokenPipe()

const program = new Command()
  .name('circi')
  .description('Upload screenshots from CI to a CirCI server')
  .version(pkg.version)
  .option('--debug', 'print the stack trace of an unexpected error (or set DEBUG=1)')
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
  .option('--author <login>', 'who made the change (default: the CI actor, e.g. GITHUB_ACTOR)')
  .option('--timeout <seconds>', 'how long --wait waits', '600')
  .addOption(apiUrlOption())
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
  CIRCI_AUTHOR   who made the change (same as --author)

Exit codes:
  0  uploaded; with --wait also: the build passed (or the git host's check is the gate)
  1  with --wait: visual changes need review and this job is the gate; approve them in
     the dashboard, then re-run the job
  2  an error: bad flags or setup, the server couldn't be reached, the build failed to
     process or a screenshot couldn't be read (--wait names the file and why; upload again
     with a valid PNG) in a project that blocks merges, or --wait timed out (--timeout)

Failed API calls are retried with backoff. Pass --debug (or set DEBUG=1) for stack traces.`,
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
        author?: string
        timeout: string
        apiUrl?: string
        fetch: boolean
        json?: boolean
      },
    ) => {
      const { apiUrl, token } = connection(opts.apiUrl)
      const timeout = Number(opts.timeout)
      if (!Number.isFinite(timeout) || timeout <= 0)
        throw new UsageError('--timeout must be a positive number of seconds')

      if (opts.gate !== undefined && opts.gate !== 'status' && opts.gate !== 'exit-code') {
        throw new UsageError('--gate must be "status" or "exit-code"')
      }
      const shard = opts.shard ? shardFlag(opts.shard, opts.nonce) : undefined
      const result = await upload({
        dir,
        apiUrl,
        token,
        name: opts.name,
        wait: opts.wait ?? false,
        ...(shard ? { shard } : {}),
        ...(opts.gate ? { gate: opts.gate } : {}),
        ...(opts.author ? { author: opts.author } : {}),
        waitTimeoutMs: timeout * 1000,
        fetch: opts.fetch,
        ...(opts.json ? { log: (line: string) => console.error(line) } : {}),
      })
      if (opts.json) console.log(JSON.stringify(result, null, 2))
      process.exitCode = result.exitCode
    },
  )

function siteCommand(parent: Command, name: string, description: string, fixedKind?: string) {
  const command = parent
    .command(name)
    .description(description)
    .argument('<dir>', 'the built site (a folder with its index.html)')
    .option('--name <name>', "which of the project's sites this is", fixedKind ?? 'site')
    .option('--spa', 'serve unknown paths with the entry page (single-page apps)')
    .addOption(apiUrlOption())
  if (!fixedKind) {
    command.option(
      '--kind <kind>',
      'storybook, vitest-report, playwright-report, coverage, docs, generic or auto',
      'auto',
    )
  }
  command.action(
    async (dir: string, opts: { name: string; kind?: string; spa?: boolean; apiUrl?: string }) => {
      const { apiUrl, token } = connection(opts.apiUrl)
      await uploadSite({
        dir,
        apiUrl,
        token,
        name: opts.name,
        kind: fixedKind ?? opts.kind ?? 'auto',
        ...(opts.spa ? { spa: true } : {}),
      })
    },
  )
}

const site = program.command('site').description('host a built static site next to the screenshots')
siteCommand(site, 'upload', 'upload a built site (Storybook, a test report, coverage, docs…)')
const storybook = program.command('storybook').description('Storybook shortcuts')
siteCommand(storybook, 'upload', 'upload a built Storybook (storybook build)', 'storybook')

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(reportError(err, debugOn(process.argv, process.env)))
  process.exitCode = 2
})
