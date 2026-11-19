import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { errorLine, upload } from '@circi/cli'

import { type CollectedScreenshot, collectDirectory } from './collect.ts'
import { DEFAULT_DIR } from './screenshot.ts'
import { type Shard, shardFromArgs } from './shard.ts'

export namespace CirciReporter {
  export interface Options {
    /** CirCI address. Default: `CIRCI_API_URL`. */
    apiUrl?: string
    /** Project CI token. Default: `CIRCI_TOKEN`. */
    token?: string
    /** Build name; give each browser project its own (`vitest-chromium`). Default `vitest`. */
    name?: string
    /** Where captures are written, relative to the project root. Default `.circi/screenshots`. */
    dir?: string
    /** Empty `dir` when the run starts, so a build holds only this run's captures. Default false. */
    clean?: boolean
    /** Project root to look in. Default: the root of the Vitest run. */
    root?: string
    /** Wait for the result and fail the run when changes need review. Default false. */
    wait?: boolean
    /** Fail the Vitest run if the upload fails. Default false: tests passed or failed on their own. */
    strict?: boolean
    /** This process's shard, if not given by `--shard`. */
    shard?: Shard
    /** For tests. */
    uploadImpl?: (options: upload.Options) => Promise<Pick<upload.Result, 'exitCode'>>
    collectImpl?: (options: CirciReporter.Options) => Promise<CollectedScreenshot[]>
    log?: (line: string) => void
  }
}

/** What Vitest calls once a run is over; only the part we use. */
type RunEnd = (
  modules: readonly unknown[],
  errors: readonly unknown[],
  reason: string,
) => Promise<void>

/**
 * A Vitest reporter that sends the run's screenshots to CirCI when it ends. Add it to
 * `test.reporters`: `['default', new CirciReporter({ name: 'vitest-chromium' })]`.
 */
export class CirciReporter {
  readonly onTestRunEnd: RunEnd
  readonly onInit: (vitest: { config: { root: string } }) => void

  constructor(options: CirciReporter.Options = {}) {
    // Captures are written under the Vitest project's root, so that is where to look, whatever
    // directory the run was started from.
    let vitestRoot: string | undefined
    this.onInit = (vitest) => {
      vitestRoot = vitest.config.root
      // A run uploads only its own captures. Synchronous and at init, before any test can write one.
      if (options.clean) {
        rmSync(resolve(vitestRoot, options.dir ?? DEFAULT_DIR), { recursive: true, force: true })
      }
    }
    this.onTestRunEnd = async () => {
      const log = options.log ?? ((l: string) => console.log(l))
      const apiUrl = options.apiUrl ?? process.env.CIRCI_API_URL
      const token = options.token ?? process.env.CIRCI_TOKEN
      if (!apiUrl || !token) {
        log('[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots')
        return
      }
      const root = options.root ?? vitestRoot ?? process.cwd()
      const dir = resolve(root, options.dir ?? DEFAULT_DIR)
      const shots = await (options.collectImpl?.({ ...options, root }) ?? collectDirectory(dir))
      if (shots.length === 0) {
        log('[circi] no screenshots found, nothing to upload')
        return
      }
      const shard = options.shard ?? shardFromArgs(process.argv)
      try {
        const result = await (options.uploadImpl ?? upload)({
          // The captures are already laid out by name, which is how the CLI names a directory's files.
          dir,
          apiUrl,
          token,
          name: options.name ?? 'vitest',
          wait: options.wait ?? false,
          ...(shard ? { shard } : {}),
          log,
        })
        if (result.exitCode !== 0 && options.wait) process.exitCode = result.exitCode
      } catch (err) {
        log(`[circi] upload failed: ${errorLine(err)}`)
        if (options.strict) process.exitCode = 1
      }
    }
  }
}
