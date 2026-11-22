import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  type CirciOptions,
  shardFromArgs,
  type upload,
  uploadCaptures,
  uploadSiteAfter,
} from '@circi/cli'
import { toolDir } from '@circi/cli/names'

import { type CollectedScreenshot, collectDirectory } from './collect.ts'
import { type HtmlReport, watchHtmlReporter } from './html-report.ts'
import { DEFAULT_DIR } from './screenshot.ts'

export namespace CirciReporter {
  /** `name` defaults to `vitest`; give each browser project its own (`vitest-chromium`). */
  export interface Options extends CirciOptions.Common {
    /**
     * Also host Vitest's HTML report as a site (kind `vitest-report`), so reviewers can open the
     * run's results next to the screenshots. Default `false`. It is uploaded after the screenshots
     * and only when they were, from the first shard only. By default the report is the one
     * Vitest's own `html` reporter writes (`.vitest`, or its `outputDir`): the `circi()` plugin
     * adds that reporter itself when `@vitest/ui` is installed, otherwise add
     * `reporters: ['default', 'html']`. `name` defaults to `vitest-report`; `dir` (relative to the
     * project root) hosts a folder you made yourself instead.
     */
    site?: boolean | { name?: string; dir?: string }
    /** For tests. */
    uploadImpl?: (options: upload.Options) => Promise<Pick<upload.Result, 'exitCode'>>
    collectImpl?: (options: CirciReporter.Options) => Promise<CollectedScreenshot[]>
    uploadSiteImpl?: uploadSiteAfter.Options['uploadSiteImpl']
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
  readonly onInit: (vitest: { config: { root: string }; reporters?: unknown[] }) => void

  constructor(options: CirciReporter.Options = {}) {
    // Captures are written under the Vitest project's root, so that is where to look, whatever
    // directory the run was started from.
    let vitestRoot: string | undefined
    let html: HtmlReport | undefined
    this.onInit = (vitest) => {
      vitestRoot = vitest.config.root
      if (options.site) html = watchHtmlReporter(vitestRoot, vitest.reporters)
      // A run uploads only its own captures. Synchronous and at init, before any test can write one.
      if (options.clean) {
        rmSync(resolve(vitestRoot, toolDir(options.dir ?? DEFAULT_DIR, 'vitest')), {
          recursive: true,
          force: true,
        })
      }
    }
    this.onTestRunEnd = async () => {
      const root = options.root ?? vitestRoot ?? process.cwd()
      const dir = resolve(root, toolDir(options.dir ?? DEFAULT_DIR, 'vitest'))
      const shard = options.shard ?? shardFromArgs(process.argv)
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
        shard,
        log: options.log,
        isEmpty: async () =>
          (await (options.collectImpl?.({ ...options, root }) ?? collectDirectory(dir))).length ===
          0,
        uploadImpl: options.uploadImpl,
      })
      let exitCode = result.exitCode
      const site = options.site
      if (site && result.status === 'uploaded' && (shard?.index ?? 0) === 0) {
        const log = options.log ?? ((line: string) => console.log(line))
        const given = typeof site === 'object' ? site : {}
        const siteDir = given.dir ? resolve(root, given.dir) : html?.dir
        if (!siteDir) {
          log(
            "[circi] site skipped: Vitest's HTML report isn't configured. Add reporters: ['default', 'html'] (needs @vitest/ui), or give site.dir a folder to host.",
          )
        } else {
          // Every reporter's onTestRunEnd runs at once: the HTML report may still be being written.
          await html?.finished()
          if (existsSync(join(siteDir, 'index.html'))) {
            const hosted = await uploadSiteAfter({
              dir: siteDir,
              name: given.name ?? 'vitest-report',
              kind: 'vitest-report',
              capturesUploaded: true,
              apiUrl: options.apiUrl,
              token: options.token,
              strict: options.strict,
              strictExitCode: 1,
              shard,
              log: options.log,
              uploadSiteImpl: options.uploadSiteImpl,
            })
            if (hosted.exitCode !== 0) exitCode = hosted.exitCode
          } else {
            log(`[circi] site skipped: ${join(siteDir, 'index.html')} doesn't exist`)
          }
        }
      }
      if (exitCode !== 0) process.exitCode = exitCode
    }
  }
}
