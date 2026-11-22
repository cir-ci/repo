import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { errorLine } from './errors.ts'
import type { CirciOptions } from './options.ts'
import { upload } from './upload.ts'

/**
 * What a `<name>.png.json` beside a capture holds: free-form JSON that `collectScreenshots` reads
 * and the server keeps with the screenshot (the labels that come later are read from it). The
 * integrations agree on: `storyId` (Storybook), `browser` (a name) and `viewport` (a string: its
 * name, or `1280x720`).
 */
export type CaptureMetadata = Record<string, unknown>

/** Writes a capture and, when there is metadata, its `.png.json` sidecar, creating the folder. */
export async function writeCapture(
  file: string,
  png: Uint8Array,
  metadata?: CaptureMetadata,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await Promise.all([
    writeFile(file, png),
    metadata ? writeFile(`${file}.json`, `${JSON.stringify(metadata, null, 2)}\n`) : undefined,
  ])
}

export namespace uploadCaptures {
  export interface Options extends Omit<CirciOptions.Common, 'dir' | 'root' | 'clean'> {
    /** The folder with the captures, absolute (or relative to the working directory). */
    dir: string
    /** The build's name when `name` isn't set: each integration has its own (`vitest`, `storybook`). */
    defaultName: string
    /**
     * The exit code for an upload that failed when `strict` is set. Default 2, the CLI's code for
     * an error (1 means "changes need review"); `@circi/vitest` keeps 1, which it has always used.
     */
    strictExitCode?: 1 | 2
    /** Looked at only once there are credentials: no captures means nothing to upload, quietly. */
    isEmpty?: () => Promise<boolean>
    /** How long `wait` waits for the build, in milliseconds. Default: the CLI's. */
    waitTimeoutMs?: number
    /** Allow `git fetch` to complete shallow history. Default true. */
    fetch?: boolean
    cwd?: string
    env?: Record<string, string | undefined>
    /** For tests. */
    uploadImpl?: (options: upload.Options) => Promise<Pick<upload.Result, 'exitCode'>>
  }

  export interface Result {
    /**
     * `skipped`: no `CIRCI_API_URL` or `CIRCI_TOKEN`. `empty`: no captures (and no shard to report). `uploaded`.
     * `failed`: the upload threw (reported, not thrown).
     */
    status: 'skipped' | 'empty' | 'uploaded' | 'failed'
    /**
     * What the run's exit code should become: the upload's own (1 changes need review, 2 an error)
     * when `wait` is set, `strictExitCode` for a failed upload when `strict` is set, else 0.
     */
    exitCode: 0 | 1 | 2
  }
}

/**
 * The end of every integration's run (Vitest, Storybook, Cypress): send the captures in `dir` to
 * CirCI as one build, unless there is nothing to send or nowhere to send it, and never throw. The
 * policy lives here once: credentials from the options, else `CIRCI_API_URL` and `CIRCI_TOKEN`;
 * without them a notice and no upload; a failed upload is reported and only `strict` turns it into
 * an exit code; only `wait` lets the build's result decide the exit code.
 */
export async function uploadCaptures(
  options: uploadCaptures.Options,
): Promise<uploadCaptures.Result> {
  const log = options.log ?? ((line: string) => console.log(line))
  const env = options.env ?? process.env
  const apiUrl = options.apiUrl ?? env.CIRCI_API_URL
  const token = options.token ?? env.CIRCI_TOKEN
  if (!apiUrl || !token) {
    log('[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots')
    return { status: 'skipped', exitCode: 0 }
  }
  if (await options.isEmpty?.()) {
    // One shard of a parallel build still reports in, empty: the build waits for every shard.
    if (!options.shard) {
      log('[circi] no screenshots found, nothing to upload')
      return { status: 'empty', exitCode: 0 }
    }
    log('[circi] no screenshots found in this shard; reporting it so the build can complete')
  }
  try {
    const result = await (options.uploadImpl ?? upload)({
      dir: options.dir,
      apiUrl,
      token,
      name: options.name ?? options.defaultName,
      wait: options.wait ?? false,
      ...(options.shard ? { shard: options.shard } : {}),
      ...(options.waitTimeoutMs ? { waitTimeoutMs: options.waitTimeoutMs } : {}),
      ...(options.fetch === false ? { fetch: false } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env,
      log,
    })
    return {
      status: 'uploaded',
      exitCode: options.wait && result.exitCode !== 0 ? result.exitCode : 0,
    }
  } catch (err) {
    log(`[circi] upload failed: ${errorLine(err)}`)
    return { status: 'failed', exitCode: options.strict ? (options.strictExitCode ?? 2) : 0 }
  }
}
