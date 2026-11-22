import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  type CirciOptions,
  errorLine,
  shardFromEnv,
  type upload,
  uploadCaptures,
  writeCapture,
} from '@circi/cli'
import { capturePath, DEFAULT_DIR, toolDir } from '@circi/cli/names'

export namespace circi {
  /** `name` defaults to `cypress`; give each browser project its own (`cypress-chrome`). */
  export interface Options extends CirciOptions.Common {
    /**
     * Empty this plugin's own folder, `<dir>/cypress`, when a run starts, so a build holds only
     * this run's screenshots. Other tools' folders under `dir` are never touched. Default true.
     */
    clean?: boolean
    /** For tests. */
    uploadImpl?: (options: upload.Options) => Promise<Pick<upload.Result, 'exitCode'>>
    env?: Record<string, string | undefined>
  }
}

/** The parts of Cypress's Node-side events and config this plugin reads (the real ones fit). */
namespace CypressNode {
  /** `after:screenshot`'s details. */
  export interface ScreenshotDetails {
    name?: string | null
    /** Only the spec's base name, and so not unique: the spec's path comes from `before:spec`. */
    specName?: string
    path: string
    testFailure?: boolean
    /** Not in Cypress's types; read when a version sends it. */
    viewport?: { width: number; height: number }
  }
  export interface RunDetails {
    browser?: { name?: string }
  }
  export interface RunResults {
    /** `failed` when Cypress could not run at all (a failed run result has no `runs`). */
    status?: string
    runs?: unknown
  }
  export interface Spec {
    /** The spec's path from the project root, as Cypress lists it. */
    relative?: string
    name?: string
  }
  /** Cypress's `on`, only the events used here (the real one accepts these handlers). */
  export interface Events {
    (event: 'before:run', handler: (details: RunDetails) => void | Promise<void>): void
    (event: 'before:spec', handler: (spec: Spec) => void | Promise<void>): void
    (
      event: 'after:screenshot',
      handler: (details: ScreenshotDetails) => Promise<{ path?: string }>,
    ): void
    (event: 'after:run', handler: (results: RunResults) => void | Promise<void>): void
  }
  export interface Config {
    projectRoot: string
    viewportWidth?: number
    viewportHeight?: number
  }
}

/** Where this plugin keeps its screenshots under the shared `dir`: one folder per tool. */
const TOOL = 'cypress'

/**
 * The Cypress plugin: `setupNodeEvents: circi({ name: 'cypress-chrome' })` in `cypress.config.ts`.
 *
 * Tests keep `cy.screenshot('name')`. Every named screenshot a run takes (not the automatic
 * screenshot of a failing test) is copied to
 * `.circi/screenshots/cypress/<spec path>/<name>.png`, with a `.png.json` sidecar naming the spec,
 * browser and viewport, and `cypress run` uploads them to CirCI when it ends. To also do your own
 * setup, call it inside yours:
 * `setupNodeEvents(on, config) { circi(options)(on, config); return config }`.
 */
export function circi(options: circi.Options = {}) {
  return function setupNodeEvents<C extends CypressNode.Config>(
    on: CypressNode.Events,
    config: C,
  ): C {
    const log = options.log ?? ((line: string) => console.log(line))
    const env = options.env ?? process.env
    const root = resolve(options.root ?? config.projectRoot)
    const parent = options.dir ?? DEFAULT_DIR
    const dirOption = toolDir(parent, TOOL)
    const dir = resolve(root, dirOption)
    let browser: string | undefined
    let spec: string | undefined
    let taken = 0

    on('before:run', async (details) => {
      browser = details.browser?.name
      taken = 0
      // A run uploads only its own captures, and only this tool's folder is ever emptied.
      if (options.clean ?? true) await rm(dir, { recursive: true, force: true })
    })

    // `specName` is a base name: `admin/home.cy.ts` and `public/home.cy.ts` would share it.
    on('before:spec', (details) => {
      spec = details.relative
    })

    on('after:screenshot', async (details) => {
      // Cypress's automatic failure screenshot and any unnamed one are not part of the review.
      if (details.testFailure || !details.name) return {}
      let file: string
      const specPath = spec || details.specName || 'unknown-spec'
      try {
        file = resolve(root, capturePath(dirOption, specPath, details.name))
      } catch (err) {
        // A name with nothing usable in it (`'!!'`) skips this screenshot, not the test.
        log(`[circi] skipped screenshot "${details.name}": ${errorLine(err)}`)
        return {}
      }
      const viewport =
        details.viewport ??
        (config.viewportWidth && config.viewportHeight
          ? { width: config.viewportWidth, height: config.viewportHeight }
          : undefined)
      // The last one wins: a retried test takes the same screenshot again.
      await writeCapture(file, await readFile(details.path), {
        spec: specPath,
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
        log,
        uploadImpl: options.uploadImpl,
      })
      // Cypress turns a throw in `after:run` into a non-zero exit code.
      if (exitCode !== 0) throw new Error(`[circi] exit code ${exitCode}`)
    })
    return config
  }
}
