import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { type CirciOptions, shardFromArgs, type upload, uploadCaptures } from '@circi/cli'

import { type CollectedScreenshot, collectDirectory } from './collect.ts'
import { DEFAULT_DIR } from './screenshot.ts'

export namespace CirciReporter {
  /** `name` defaults to `vitest`; give each browser project its own (`vitest-chromium`). */
  export interface Options extends CirciOptions.Common {
    /** For tests. */
    uploadImpl?: (options: upload.Options) => Promise<Pick<upload.Result, 'exitCode'>>
    collectImpl?: (options: CirciReporter.Options) => Promise<CollectedScreenshot[]>
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
      const root = options.root ?? vitestRoot ?? process.cwd()
      const dir = resolve(root, options.dir ?? DEFAULT_DIR)
      const result = await uploadCaptures({
        // The captures are already laid out by name, which is how the CLI names a directory's files.
        dir,
        defaultName: 'vitest',
        name: options.name,
        apiUrl: options.apiUrl,
        token: options.token,
        wait: options.wait,
        strict: options.strict,
        // What this reporter has always exited with when a strict upload fails.
        strictExitCode: 1,
        shard: options.shard ?? shardFromArgs(process.argv),
        log: options.log,
        isEmpty: async () =>
          (await (options.collectImpl?.({ ...options, root }) ?? collectDirectory(dir))).length ===
          0,
        uploadImpl: options.uploadImpl,
      })
      if (result.exitCode !== 0) process.exitCode = result.exitCode
    }
  }
}
