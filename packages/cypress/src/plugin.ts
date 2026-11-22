import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { errorLine, parseShard, upload } from '@circi/cli'

import { capturePath, DEFAULT_DIR } from './names.ts'

/** A shard of a parallel run: `index` is 0-based. */
export interface Shard {
  index: number
  total: number
}

export namespace circi {
  /** The same options, names and defaults as `CirciReporter.Options` in @circi/vitest. */
  export interface Options {
    /** CirCI address. Default: `CIRCI_API_URL`. */
    apiUrl?: string
    /** Project CI token. Default: `CIRCI_TOKEN`. */
    token?: string
    /** Build name; give each browser project its own (`cypress-chrome`). Default `cypress`. */
    name?: string
    /** Where captures are written, relative to the project root. Default `.circi/screenshots`. */
    dir?: string
    /** Empty `dir` when the run starts, so a build holds only this run's captures. Default true. */
    clean?: boolean
    /** Project root to look in. Default: Cypress's `projectRoot`. */
    root?: string
    /** Wait for the result and fail the run when changes need review. Default false. */
    wait?: boolean
    /** Fail the Cypress run if the upload fails. Default false: tests passed or failed on their own. */
    strict?: boolean
    /** This machine's shard, if not given by `CIRCI_SHARD` (`2/4`, 1-based). */
    shard?: Shard
    /** For tests. */
    uploadImpl?: (options: upload.Options) => Promise<Pick<upload.Result, 'exitCode'>>
    log?: (line: string) => void
    env?: Record<string, string | undefined>
  }
}

/** The parts of Cypress's `after:screenshot` details this plugin reads. */
interface ScreenshotDetails {
  name?: string | null
  specName?: string
  path: string
  testFailure?: boolean
  /** Not in Cypress's types; read when a version sends it. */
  viewport?: { width: number; height: number }
}

/** The parts of the `before:run` and `after:run` payloads this plugin reads. */
interface RunDetails {
  browser?: { name?: string }
}
interface RunResults {
  /** `failed` when Cypress could not run at all (a failed run result has no `runs`). */
  status?: string
  runs?: unknown
}

/** Cypress's `on`, only the events used here (the real one accepts these handlers). */
interface Events {
  (event: 'before:run', handler: (details: RunDetails) => void | Promise<void>): void
  (
    event: 'after:screenshot',
    handler: (details: ScreenshotDetails) => Promise<{ path?: string }>,
  ): void
  (event: 'after:run', handler: (results: RunResults) => void | Promise<void>): void
}

interface Config {
  projectRoot: string
  viewportWidth?: number
  viewportHeight?: number
}

async function countPngs(dir: string): Promise<number> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [])
  return entries.filter((e) => e.endsWith('.png')).length
}

/**
 * The Cypress plugin: `setupNodeEvents: circi({ name: 'cypress-chrome' })` in `cypress.config.ts`.
 *
 * Tests keep `cy.screenshot('name')`. Every named screenshot a run takes (not the automatic
 * screenshot of a failing test) is copied to `.circi/screenshots/<spec file>/<name>.png`, with a
 * `.png.json` sidecar naming the spec, browser and viewport, and `cypress run` uploads them to
 * CirCI when it ends. To also do your own setup, call it inside yours:
 * `setupNodeEvents(on, config) { circi(options)(on, config); return config }`.
 */
export function circi(options: circi.Options = {}) {
  return function setupNodeEvents<C extends Config>(on: Events, config: C): C {
    const log = options.log ?? ((line: string) => console.log(line))
    const env = options.env ?? process.env
    const root = resolve(options.root ?? config.projectRoot)
    const dir = resolve(root, options.dir ?? DEFAULT_DIR)
    let browser: string | undefined

    on('before:run', async (details) => {
      browser = details.browser?.name
      // A run uploads only its own captures.
      if (options.clean ?? true) await rm(dir, { recursive: true, force: true })
    })

    on('after:screenshot', async (details) => {
      // Cypress's automatic failure screenshot and any unnamed one are not part of the review.
      if (details.testFailure || !details.name) return {}
      const file = resolve(
        root,
        capturePath(options.dir ?? DEFAULT_DIR, details.specName, details.name),
      )
      await mkdir(dirname(file), { recursive: true })
      // The last one wins: a retried test takes the same screenshot again.
      await copyFile(details.path, file)
      const viewport =
        details.viewport ??
        (config.viewportWidth && config.viewportHeight
          ? { width: config.viewportWidth, height: config.viewportHeight }
          : undefined)
      await writeFile(
        `${file}.json`,
        JSON.stringify({
          spec: details.specName,
          ...(browser ? { browser } : {}),
          ...(viewport ? { viewport } : {}),
        }),
      )
      // Nothing changes for Cypress: the screenshot stays where it was written.
      return {}
    })

    on('after:run', async (results) => {
      // The run itself failed to start: there is nothing to upload.
      if (results.status === 'failed') return
      const apiUrl = options.apiUrl ?? env.CIRCI_API_URL
      const token = options.token ?? env.CIRCI_TOKEN
      if (!apiUrl || !token) {
        log('[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots')
        return
      }
      if ((await countPngs(dir)) === 0) {
        log('[circi] no screenshots found, nothing to upload')
        return
      }
      const fromEnv = env.CIRCI_SHARD ? parseShard(env.CIRCI_SHARD) : undefined
      const shard = options.shard ?? fromEnv
      let exitCode = 0
      try {
        const result = await (options.uploadImpl ?? upload)({
          dir,
          apiUrl,
          token,
          name: options.name ?? 'cypress',
          wait: options.wait ?? false,
          ...(shard ? { shard } : {}),
          cwd: root,
          env,
          log,
        })
        if (result.exitCode !== 0 && options.wait) exitCode = result.exitCode
      } catch (err) {
        log(`[circi] upload failed: ${errorLine(err)}`)
        if (options.strict) exitCode = 1
      }
      if (exitCode !== 0) throw new Error(`[circi] exit code ${exitCode}`)
    })
    return config
  }
}
