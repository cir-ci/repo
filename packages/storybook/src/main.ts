#!/usr/bin/env node
import { debugOn, parseShard, reportError, UsageError } from '@circi/cli'
import { Command } from 'commander'

import pkg from '../package.json' with { type: 'json' }
import { uploadStorybook } from './run.ts'
import type { circi } from './types.ts'

// If whoever reads our output goes away (`… | head -1`), keep going quietly instead of dying with EPIPE.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}

const program = new Command()
  .name('circi-storybook')
  .description('Screenshot every Storybook story and upload the screenshots to CirCI')
  .version(pkg.version)
  .option('--debug', 'print the stack trace of an unexpected error (or set DEBUG=1)')
  .showHelpAfterError()

interface Flags {
  build?: boolean
  root?: string
  configDir?: string
  dir?: string
  name?: string
  clean?: boolean
  browser?: string[]
  viewport?: string[]
  concurrency?: string
  include?: string[]
  exclude?: string[]
  site?: string | boolean
  padding?: string
  delay?: string
  storyTimeout?: string
  wait?: boolean
  strict?: boolean
  shard?: string
  nonce?: string
  timeout?: string
  apiUrl?: string
  fetch: boolean
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, ...value.split(',').filter((part) => part !== '')]
}

function numberFlag(text: string | undefined, flag: string): number | undefined {
  if (text === undefined) return undefined
  const n = Number(text)
  if (!Number.isFinite(n)) throw new UsageError(`${flag} must be a number`)
  return n
}

program
  .command('upload')
  .description('screenshot the stories of a built Storybook and upload them as a build')
  .argument('[dir]', 'the built Storybook (default: staticDir of the addon, or storybook-static)')
  .option('--build', 'run `storybook build` into the folder first')
  .option('--root <dir>', 'project root (default: the working directory)')
  .option(
    '--config-dir <dir>',
    "Storybook's config folder, where the addon's options are read",
    '.storybook',
  )
  .option(
    '--dir <dir>',
    'where screenshots are written, under the root (default: .circi/screenshots)',
  )
  .option('--name <name>', 'build name (default: storybook)')
  .option('--clean', 'empty the screenshots folder first')
  .option('--browser <name>', 'chromium, firefox or webkit; repeat or comma-separate', collect)
  .option(
    '--viewport <size>',
    'such as 1280x720 or mobile=390x844; repeat or comma-separate',
    collect,
  )
  .option('--concurrency <n>', 'stories screenshotted at once (default: 4)')
  .option(
    '--include <glob>',
    'only stories matching a story ID or Title/Story name; repeatable',
    collect,
  )
  .option('--exclude <glob>', 'leave out matching stories; repeatable', collect)
  .option(
    '--site [name]',
    'also upload the built Storybook as a hosted site (default name: storybook)',
  )
  .option('--padding <px>', 'pixels around the component to include (default: 0)')
  .option('--delay <ms>', 'wait after a story has rendered (default: 0)')
  .option('--story-timeout <seconds>', 'how long a story may take to render (default: 30)')
  .option('--wait', 'wait for the result and exit 1 when changes need review')
  .option('--strict', 'exit 2 if the upload fails')
  .option(
    '--shard <n/total>',
    'screenshot and upload shard n of total (e.g. 2/4) of one parallel build',
  )
  .option('--nonce <id>', 'ties the shards of one build together (default: the CI run ID)')
  .option('--timeout <seconds>', 'how long --wait waits', '600')
  .option('--api-url <url>', 'CirCI address (default: CIRCI_API_URL)')
  .option('--no-fetch', "don't run git fetch to complete shallow history")
  .addHelpText(
    'after',
    `
Options can also be set once, in .storybook/main.ts: addons: [circi({ browsers: ['chromium'] })].
Flags override them. A story's own settings are parameters.circi (skip, viewports, delay, selector, padding).

Environment:
  CIRCI_TOKEN    project CI token
  CIRCI_API_URL  CirCI address, e.g. https://ci.acme.io
  Without both, the screenshots are written and not uploaded.

Exit codes:
  0  done; with --wait also: the build passed (or the git host's check is the gate)
  1  with --wait: visual changes need review and this job is the gate
  2  a story couldn't be screenshotted (nothing is uploaded), bad flags or setup, or
     the upload failed with --strict`,
  )
  .action(async (dir: string | undefined, flags: Flags) => {
    const shard = flags.shard ? shardFlag(flags.shard, flags.nonce) : undefined
    const timeout = numberFlag(flags.timeout, '--timeout')
    const options: uploadStorybook.Options = {
      staticDir: dir,
      build: flags.build,
      root: flags.root,
      configDir: flags.configDir,
      dir: flags.dir,
      name: flags.name,
      clean: flags.clean,
      browsers: flags.browser?.map(browserFlag),
      viewports: flags.viewport,
      concurrency: numberFlag(flags.concurrency, '--concurrency'),
      include: flags.include,
      exclude: flags.exclude,
      site: flags.site ? (typeof flags.site === 'string' ? { name: flags.site } : true) : undefined,
      padding: numberFlag(flags.padding, '--padding'),
      delay: numberFlag(flags.delay, '--delay'),
      timeout: numberFlag(flags.storyTimeout, '--story-timeout'),
      wait: flags.wait,
      strict: flags.strict,
      shard,
      apiUrl: flags.apiUrl,
      waitTimeout: timeout,
      fetch: flags.fetch,
    }
    const result = await uploadStorybook(options)
    process.exitCode = result.exitCode
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(reportError(err, debugOn(process.argv, process.env)))
  process.exitCode = 2
})

function browserFlag(name: string): circi.Browser {
  if (name === 'chromium' || name === 'firefox' || name === 'webkit') return name
  throw new UsageError(`Unknown browser "${name}": use chromium, firefox or webkit`)
}

function shardFlag(text: string, nonce: string | undefined) {
  const shard = parseShard(text)
  if (!shard) {
    throw new UsageError(
      "--shard must look like 1/4: this job's number, then how many jobs there are",
    )
  }
  return { ...shard, ...(nonce ? { nonce } : {}) }
}
