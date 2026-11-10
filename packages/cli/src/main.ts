#!/usr/bin/env node
import { Command } from 'commander'

import pkg from '../package.json' with { type: 'json' }
import { ApiError } from './api.ts'
import { uploadSite } from './site.ts'
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
  .version(pkg.version)
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
  .option('--api-url <url>', 'CirCI address (default: CIRCI_API_URL)')
  .option('--no-fetch', "don't run git fetch to complete shallow history")
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    `
Environment:
  CIRCI_TOKEN    team CI token (required)
  CIRCI_API_URL  CirCI address, e.g. https://ci.acme.io
  CIRCI_COMMIT, CIRCI_BRANCH, CIRCI_PR_NUMBER, CIRCI_BASE_BRANCH
                 override what is detected from the CI environment
  CIRCI_AUTHOR   who made the change (same as --author)

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
        author?: string
        timeout: string
        apiUrl?: string
        fetch: boolean
        json?: boolean
      },
    ) => {
      const token = process.env.CIRCI_TOKEN
      const apiUrl = opts.apiUrl ?? process.env.CIRCI_API_URL
      if (!token) throw new UsageError('Set CIRCI_TOKEN to the team CI token')
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
    .option('--name <name>', "which of the team's sites this is", fixedKind ?? 'site')
    .option('--spa', 'serve unknown paths with the entry page (single-page apps)')
    .option('--api-url <url>', 'CirCI address (default: CIRCI_API_URL)')
  if (!fixedKind) {
    command.option(
      '--kind <kind>',
      'storybook, vitest-report, playwright-report, coverage, docs, generic or auto',
      'auto',
    )
  }
  command.action(
    async (dir: string, opts: { name: string; kind?: string; spa?: boolean; apiUrl?: string }) => {
      const token = process.env.CIRCI_TOKEN
      const apiUrl = opts.apiUrl ?? process.env.CIRCI_API_URL
      if (!token) throw new UsageError('Set CIRCI_TOKEN to the team CI token')
      if (!apiUrl) throw new UsageError('Set CIRCI_API_URL (or --api-url) to your CirCI address')
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

program
  .command('argos-env')
  .description('print the environment that points the Argos SDKs at this CirCI server')
  .option('--api-url <url>', 'CirCI address (default: CIRCI_API_URL)')
  .action((opts: { apiUrl?: string }) => {
    const apiUrl = opts.apiUrl ?? process.env.CIRCI_API_URL
    const token = process.env.CIRCI_TOKEN
    if (!apiUrl) throw new UsageError('Set CIRCI_API_URL (or --api-url) to your CirCI address')
    if (!token) throw new UsageError('Set CIRCI_TOKEN to the team CI token')
    // `eval "$(circi argos-env)"` in a shell, or append the output to $GITHUB_ENV.
    console.log(`ARGOS_API_BASE_URL=${apiUrl.replace(/\/$/, '')}/v2`)
    console.log(`ARGOS_TOKEN=${token}`)
  })

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
