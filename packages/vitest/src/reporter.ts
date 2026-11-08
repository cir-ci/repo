import { resolve } from 'node:path'

import { upload } from '@circi/cli'

import { type CollectedScreenshot, collectDirectory, collectToMatchScreenshot } from './collect.ts'
import { DEFAULT_DIR } from './screenshot.ts'
import { type Shard, shardFromArgs } from './shard.ts'

export namespace CirciReporter {
  export interface Options {
    /** CirCI address. Default: `CIRCI_API_URL`. */
    apiUrl?: string
    /** Team CI token. Default: `CIRCI_TOKEN`. */
    token?: string
    /** Build name; give each browser project its own (`vitest-chromium`). Default `vitest`. */
    name?: string
    /** Where `circiScreenshot` wrote. Default `.circi/screenshots`. */
    dir?: string
    /** Also upload the pictures Vitest's `toMatchScreenshot` produced. Default false. */
    collectToMatchScreenshot?: boolean
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
    // `circiScreenshot` saves under the Vitest project's root, so that is where to look, whatever
    // directory the run was started from.
    let vitestRoot: string | undefined
    this.onInit = (vitest) => {
      vitestRoot = vitest.config.root
    }
    this.onTestRunEnd = async () => {
      const log = options.log ?? ((l: string) => console.log(l))
      const apiUrl = options.apiUrl ?? process.env.CIRCI_API_URL
      const token = options.token ?? process.env.CIRCI_TOKEN
      if (!apiUrl || !token) {
        log('[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots')
        return
      }
      const shots = await (options.collectImpl ?? collect)({
        ...options,
        root: options.root ?? vitestRoot,
      })
      if (shots.length === 0) {
        log('[circi] no screenshots found, nothing to upload')
        return
      }
      const shard = options.shard ?? shardFromArgs(process.argv)
      try {
        const result = await (options.uploadImpl ?? upload)({
          // The CLI uploads a directory; the files are mirrored into one below.
          dir: await stage(shots),
          apiUrl,
          token,
          name: options.name ?? 'vitest',
          wait: options.wait ?? false,
          ...(shard ? { shard } : {}),
          log,
        })
        if (result.exitCode !== 0 && options.wait) process.exitCode = result.exitCode
      } catch (err) {
        log(`[circi] upload failed: ${err instanceof Error ? err.message : String(err)}`)
        if (options.strict) process.exitCode = 1
      }
    }
  }
}

async function collect(options: CirciReporter.Options): Promise<CollectedScreenshot[]> {
  const root = options.root ?? process.cwd()
  const own = await collectDirectory(resolve(root, options.dir ?? DEFAULT_DIR))
  const adopted = options.collectToMatchScreenshot ? await collectToMatchScreenshot(root) : []
  const names = new Set(own.map((s) => s.name))
  return [...own, ...adopted.filter((s) => !names.has(s.name))]
}

/** Copies the collected files into one temporary directory laid out by name. */
async function stage(shots: CollectedScreenshot[]): Promise<string> {
  const { cp, mkdir, mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { dirname, join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'circi-vitest-'))
  await Promise.all(
    shots.map(async (s) => {
      const target = join(dir, `${s.name}.png`)
      await mkdir(dirname(target), { recursive: true })
      await cp(s.path, target)
    }),
  )
  return dir
}
