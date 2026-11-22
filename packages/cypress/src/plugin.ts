import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  type CirciOptions,
  shardFromEnv,
  type upload,
  uploadCaptures,
  writeCapture,
} from '@circi/cli'
import { capturePath, DEFAULT_DIR } from '@circi/cli/names'

export namespace circi {
  /** `name` defaults to `cypress`; give each browser project its own (`cypress-chrome`). */
  export interface Options extends CirciOptions.Common {
    /** Empty `dir` when a run starts, so a build holds only this run's captures. Default true. */
    clean?: boolean
    /** For tests. */
    uploadImpl?: (options: upload.Options) => Promise<Pick<upload.Result, 'exitCode'>>
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
    const env = options.env ?? process.env
    const root = resolve(options.root ?? config.projectRoot)
    const dirOption = options.dir ?? DEFAULT_DIR
    const dir = resolve(root, dirOption)
    let browser: string | undefined
    let taken = 0

    on('before:run', async (details) => {
      browser = details.browser?.name
      taken = 0
      // A run uploads only its own captures.
      if (options.clean ?? true) await rm(dir, { recursive: true, force: true })
    })

    on('after:screenshot', async (details) => {
      // Cypress's automatic failure screenshot and any unnamed one are not part of the review.
      if (details.testFailure || !details.name) return {}
      const file = resolve(
        root,
        capturePath(dirOption, details.specName || 'unknown-spec', details.name),
      )
      const viewport =
        details.viewport ??
        (config.viewportWidth && config.viewportHeight
          ? { width: config.viewportWidth, height: config.viewportHeight }
          : undefined)
      // The last one wins: a retried test takes the same screenshot again.
      await writeCapture(file, await readFile(details.path), {
        spec: details.specName,
        ...(browser ? { browser } : {}),
        ...(viewport ? { viewport: `${viewport.width}x${viewport.height}` } : {}),
      })
      taken += 1
      // Nothing changes for Cypress: the screenshot stays where it was written.
      return {}
    })

    on('after:run', async (results) => {
      // The run itself failed to start: there is nothing to upload.
      if (results.status === 'failed') return
      const { exitCode } = await uploadCaptures({
        dir,
        defaultName: 'cypress',
        name: options.name,
        apiUrl: options.apiUrl,
        token: options.token,
        wait: options.wait,
        strict: options.strict,
        strictExitCode: 1,
        shard: options.shard ?? shardFromEnv(env),
        isEmpty: () => Promise.resolve(taken === 0),
        cwd: root,
        env,
        log: options.log,
        uploadImpl: options.uploadImpl,
      })
      // Cypress turns a throw in `after:run` into a non-zero exit code.
      if (exitCode !== 0) throw new Error(`[circi] exit code ${exitCode}`)
    })
    return config
  }
}
