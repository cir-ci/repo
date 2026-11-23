import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { errorLine, mapLimit, UsageError, uploadCaptures, uploadSiteAfter } from '@circi/cli'

import { captureStory, launch, StoryError } from './capture.ts'
import { loadAddonOptions, type Resolved, resolveOptions } from './config.ts'
import { serveStatic } from './server.ts'
import { filterStories, parseIndex, shardStories, type Story, storyNames } from './stories.ts'
import type { circi } from './types.ts'

export namespace uploadStorybook {
  export interface Options extends circi.Options {
    /** Storybook's config folder, relative to the root. Default `.storybook`. */
    configDir?: string
    /** How long `wait` waits for the build, in seconds. Default 600. */
    waitTimeout?: number
    /** Allow `git fetch` to complete shallow history. Default true. */
    fetch?: boolean
    cwd?: string
    env?: Record<string, string | undefined>
  }

  export interface Failure {
    storyId: string
    browser: string
    reason: string
  }

  export interface Result {
    /** 0 done, 1 changes need review (with `wait`), 2 a story failed or something went wrong. */
    exitCode: 0 | 1 | 2
    /** Screenshots written. */
    screenshots: number
    /** Stories left out by `parameters.circi.skip`, `include`, `exclude` or another shard. */
    skipped: number
    failures: Failure[]
    uploaded: boolean
  }
}

/**
 * Screenshots every story of a built Storybook and uploads the PNGs to CirCI. Options come from the
 * addon's entry in `.storybook/main`, overridden by `flags`. A story that fails is reported and the
 * rest still run; a run with a failed story uploads nothing, since the story would show up in CirCI
 * as a removed screenshot, and exits 2.
 */
export async function uploadStorybook(
  flags: uploadStorybook.Options = {},
): Promise<uploadStorybook.Result> {
  const log = flags.log ?? ((line: string) => console.log(line))
  const env = flags.env ?? process.env
  const cwd = flags.cwd ?? process.cwd()
  const fromConfig = await loadAddonOptions(resolve(cwd, flags.root ?? '.'), flags.configDir)
  const options = resolveOptions({ ...fromConfig, ...definedOnly(flags) }, cwd)

  if (options.build) await buildStorybook(options, flags.configDir, log)
  const stories = await readStories(options)
  const wanted = filterStories(stories, options.include, options.exclude)
  if (wanted.length === 0) {
    throw new UsageError(
      stories.length === 0
        ? `${options.staticDir} has no stories`
        : 'No stories match include and exclude',
    )
  }
  const mine = shardStories(wanted, options.shard)
  // A shard with no stories still reports in, empty (more shards than stories, or every story
  // skipped): the build waits for every shard.
  if (options.clean) await rm(options.outDir, { recursive: true, force: true })
  await mkdir(options.outDir, { recursive: true })

  const { screenshots, skipped, failures } = mine.length
    ? await captureAll(mine, stories, options)
    : { screenshots: 0, skipped: 0, failures: [] }
  const result: uploadStorybook.Result = {
    exitCode: 0,
    screenshots,
    skipped: stories.length - mine.length + skipped,
    failures,
    uploaded: false,
  }
  log(
    `[circi] ${screenshots} ${screenshots === 1 ? 'screenshot' : 'screenshots'} written to ${options.outDir}`,
  )
  for (const failure of failures) {
    log(`error: ${failure.storyId} (${failure.browser}): ${failure.reason}`)
  }
  if (failures.length > 0) {
    log(
      `[circi] ${failures.length} ${failures.length === 1 ? 'story' : 'stories'} failed, so nothing was uploaded: a partial build would show them as removed. Fix them, or exclude them.`,
    )
    return { ...result, exitCode: 2 }
  }
  if (screenshots === 0 && !options.shard) {
    throw new UsageError('Every story skipped itself: nothing to upload')
  }

  const sent = await uploadCaptures({
    dir: options.outDir,
    defaultName: 'storybook',
    name: options.name,
    apiUrl: options.apiUrl,
    token: options.token,
    wait: options.wait,
    strict: options.strict,
    shard: options.shard,
    ...(flags.waitTimeout ? { waitTimeoutMs: flags.waitTimeout * 1000 } : {}),
    ...(flags.fetch === false ? { fetch: false } : {}),
    cwd,
    env,
    log,
  })
  result.uploaded = sent.status === 'uploaded'
  result.exitCode = sent.exitCode
  if (options.site) {
    const site = await uploadSiteAfter({
      dir: options.staticDir,
      name: options.site.name,
      kind: 'storybook',
      capturesUploaded: sent.status === 'uploaded',
      apiUrl: options.apiUrl,
      token: options.token,
      strict: options.strict,
      shard: options.shard,
      cwd,
      env,
      log,
    })
    if (site.exitCode !== 0) result.exitCode = site.exitCode
  }
  return result
}

/** Every story in every browser, a bounded number at a time; failures are collected, not thrown. */
async function captureAll(
  mine: Story[],
  stories: Story[],
  options: Resolved,
): Promise<{ screenshots: number; skipped: number; failures: uploadStorybook.Failure[] }> {
  const names = storyNames(stories)
  const failures: uploadStorybook.Failure[] = []
  const perBrowser: Shots[][] = []
  const server = await serveStatic(options.staticDir)
  try {
    for (const browserName of options.browsers) {
      // One browser at a time, its stories in parallel: browsers are heavy, pages are not.
      // oxlint-disable-next-line no-await-in-loop
      const browser = await launch(browserName)
      try {
        const settings = {
          baseUrl: server.url,
          outDir: options.outDir,
          timeout: options.timeout,
          padding: options.padding,
          delay: options.delay,
          viewports: options.viewports,
          multipleBrowsers: options.browsers.length > 1,
        }
        // oxlint-disable-next-line no-await-in-loop
        const results = await mapLimit(mine, options.concurrency, async (story) => {
          try {
            return await captureStory(
              browser,
              browserName,
              story,
              names.get(story) ?? story.id,
              settings,
            )
          } catch (err) {
            const reason = err instanceof StoryError ? err.message : errorLine(err)
            failures.push({ storyId: story.id, browser: browserName, reason })
            return undefined
          }
        })
        perBrowser.push(results)
      } finally {
        // oxlint-disable-next-line no-await-in-loop
        await browser.close()
      }
    }
  } finally {
    await server.close()
  }
  return { ...tally(mine, perBrowser), failures }
}

/** What one story's capture gave: its shots (none when it skips itself), or undefined when it failed. */
type Shots = { name: string }[] | undefined

/**
 * Screenshots taken, and stories that skipped themselves. A story skips itself in every browser, so
 * it counts once however many browsers there are.
 */
export function tally(
  stories: readonly { id: string }[],
  perBrowser: readonly (readonly Shots[])[],
): { screenshots: number; skipped: number } {
  const skipped = new Set<string>()
  let screenshots = 0
  for (const results of perBrowser) {
    for (const [index, shots] of results.entries()) {
      if (shots?.length === 0) skipped.add(stories[index]?.id ?? '')
      screenshots += shots?.length ?? 0
    }
  }
  return { screenshots, skipped: skipped.size }
}

async function readStories(options: Resolved): Promise<Story[]> {
  if (!existsSync(options.staticDir)) {
    throw new UsageError(
      `No built Storybook at ${options.staticDir}. Run storybook build, or set build: true (--build).`,
    )
  }
  let text: string
  try {
    text = await readFile(join(options.staticDir, 'index.json'), 'utf8')
  } catch {
    const files = await readdir(options.staticDir).catch((): string[] => [])
    throw new UsageError(
      `${options.staticDir} has no index.json${files.includes('stories.json') ? ' (only stories.json: build with Storybook 7 or later)' : ''}. Is it the output of storybook build?`,
    )
  }
  try {
    return parseIndex(JSON.parse(text))
  } catch (err) {
    throw new UsageError(`${join(options.staticDir, 'index.json')}: ${errorLine(err)}`)
  }
}

/** Runs the project's own `storybook build` into the folder the screenshots are taken from. */
export async function buildStorybook(
  options: Pick<Resolved, 'root' | 'staticDir'>,
  configDir: string | undefined,
  log: (line: string) => void,
  spawnImpl: (command: string, args: string[], opts: object) => ChildProcess = spawn,
): Promise<void> {
  log(`[circi] storybook build → ${options.staticDir}`)
  const args = ['--no-install', 'storybook', 'build', '--output-dir', options.staticDir]
  if (configDir) args.push('--config-dir', configDir)
  const code = await new Promise<number | null>((done, fail) => {
    const child = spawnImpl(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
      cwd: options.root,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.once('error', fail)
    child.once('close', done)
  })
  if (code !== 0) throw new UsageError(`storybook build failed (exit code ${code ?? 'none'})`)
}

/** `value` without the properties that are undefined, so a flag that wasn't given doesn't hide the config's. */
function definedOnly<T extends object>(value: T): T {
  const copy = { ...value }
  for (const key of Reflect.ownKeys(copy)) {
    if (Reflect.get(copy, key) === undefined) Reflect.deleteProperty(copy, key)
  }
  return copy
}
