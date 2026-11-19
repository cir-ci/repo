import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

import { ApiClient, ApiError, isRetryable } from './api.ts'
import { ciRunId, type detectCi } from './ci-env.ts'
import { mapLimit } from './concurrency.ts'
import { buildContext } from './context.ts'
import { errorLine, UsageError } from './errors.ts'
import { collectScreenshots } from './files.ts'
import { collectAncestry, gitRunner } from './git.ts'

export namespace upload {
  export interface Options {
    dir: string
    apiUrl: string
    token: string
    /** Build name, for several kinds of builds per commit (e.g. `chromium`, `mobile`). */
    name?: string
    wait?: boolean
    /**
     * This job uploads one shard of a parallel build: `index` is 0-based. Shards of one build
     * share a nonce (default: the CI run's id), and the build is processed once all `total` arrive.
     */
    shard?: { index: number; total: number; nonce?: string }
    /** Who blocks the merge: the git host's check (`status`) or this job (`exit-code`). Default: the server decides. */
    gate?: 'status' | 'exit-code'
    /** Who made the change (`--author`); replaces what the CI environment says. */
    author?: string
    waitTimeoutMs?: number
    pollIntervalMs?: number
    /** First backoff between retries of a failed API call, in milliseconds (default 500). */
    retryDelayMs?: number
    /** Allow `git fetch` to complete shallow history (default true). */
    fetch?: boolean
    cwd?: string
    env?: Record<string, string | undefined>
    fetchImpl?: typeof fetch
    log?: (line: string) => void
  }

  export interface Result {
    /**
     * 0 pass, 1 the result should block the merge, 2 something went wrong (including a build the
     * server couldn't process).
     */
    exitCode: 0 | 1 | 2
    build: ApiClient.Build
    ci: detectCi.Context
    ancestry: collectAncestry.Result
    uploaded: number
    deduplicated: number
    status?: ApiClient.Status
  }
}

const UPLOAD_CONCURRENCY = 8

export async function upload(options: upload.Options): Promise<upload.Result> {
  const log = options.log ?? ((line: string) => console.log(line))
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()

  // Check the flags before touching the disk or the network.
  const parallel = parallelOf(options.shard, env)

  const client = new ApiClient({
    baseUrl: options.apiUrl,
    token: options.token,
    fetch: options.fetchImpl,
    retryDelayMs: options.retryDelayMs,
  })
  const git = gitRunner(cwd)

  // Hashing the files, asking the server about the project and reading the checkout don't
  // depend on each other.
  const [shots, context] = await Promise.all([
    collectScreenshots(options.dir),
    (async () => {
      const [project, ci] = await Promise.all([client.project(), buildContext(env, git)])
      if (options.author?.trim()) ci.author = { login: options.author.trim() }
      const isBaseBranchBuild = !ci.prNumber && ci.branch === project.defaultBranch
      const ancestry = await collectAncestry(git, {
        headSha: ci.commitSha,
        baseBranch: ci.baseBranch ?? project.defaultBranch,
        isBaseBranchBuild,
        fetch: options.fetch ?? true,
      })
      return { project, ci, commitSha: ci.commitSha, isBaseBranchBuild, ancestry }
    })(),
  ])
  if (shots.length === 0) throw new UsageError(`No .png files found in ${options.dir}`)
  const { project, ci, commitSha, isBaseBranchBuild, ancestry } = context
  log(`Found ${plural(shots.length, 'screenshot')} in ${options.dir}`)
  if (ancestry.warning) {
    log(
      `warning: ${ancestry.warning}. CirCI will compare against the latest ${project.defaultBranch} build instead.`,
    )
  }

  log(
    `Uploading for ${commitSha.slice(0, 12)}` +
      (ci.branch ? ` on ${ci.branch}` : '') +
      (ci.prNumber ? ` (PR #${ci.prNumber})` : ''),
  )
  const { build, uploads } = await client.createBuild({
    commitSha,
    ...(options.name ? { name: options.name } : {}),
    branch: ci.branch ?? null,
    prNumber: ci.prNumber ?? null,
    baseBranch: ci.baseBranch ?? (isBaseBranchBuild ? null : project.defaultBranch),
    mergeBaseSha: ancestry.mergeBaseSha ?? null,
    ancestorShas: ancestry.ancestorShas,
    ancestryStatus: ancestry.status,
    ...(parallel ? { parallel } : {}),
    ...(ci.author ? { author: ci.author } : {}),
    files: uniqueFiles(shots),
  })

  const byHash = new Map(shots.map((s) => [s.sha256, s]))
  const unique = byHash.size
  const deduplicated = unique - uploads.length
  log(
    `Build #${build.number}: sending ${uploads.length} of ${unique} files (${deduplicated} already on the server)`,
  )
  await sendAll(client, uploads, byHash, log)
  const finalizeBody = {
    ...(options.shard ? { shardIndex: String(options.shard.index) } : {}),
    screenshots: shots.map((s) => ({
      name: s.name,
      sha256: s.sha256,
      ...(s.metadata ? { metadata: s.metadata } : {}),
    })),
  }
  try {
    await client.finalize(build.id, finalizeBody)
  } catch (err) {
    // Something didn't land (e.g. a storage hiccup): resend those files once, then retry.
    const missing = missingFrom(err)
    if (!missing) throw err
    log(`${plural(missing.length, 'file')} didn't arrive; sending again`)
    await sendAll(
      client,
      uploads.filter((u) => missing.includes(u.sha256)),
      byHash,
      log,
    )
    await client.finalize(build.id, finalizeBody)
  }
  log(`Build #${build.number}: ${build.url}`)
  if (options.shard) {
    log(`  shard ${options.shard.index + 1} of ${options.shard.total} uploaded`)
  }
  log(
    `  ${plural(shots.length, 'screenshot')}: ${uploads.length} uploaded, ${deduplicated} already on the server`,
  )

  const result: upload.Result = {
    exitCode: 0,
    build,
    ci,
    ancestry,
    uploaded: uploads.length,
    deduplicated,
  }
  if (!options.wait) return result

  log('Waiting for the result…')
  const status = await waitForResult(client, build.id, {
    timeoutMs: options.waitTimeoutMs ?? 10 * 60_000,
    ...(options.pollIntervalMs !== undefined ? { intervalMs: options.pollIntervalMs } : {}),
    ...(options.gate ? { gate: options.gate } : {}),
    onTransient: (err) => log(`warning: ${errorLine(err)}; still waiting`),
  })
  result.status = status
  if (!status) {
    log('error: timed out waiting for the build to be processed')
    result.exitCode = 2
    return result
  }
  if (status.build.status === 'error') {
    // The server couldn't process the build: nothing to review, so no review advice either.
    // (A project that doesn't block merges still gets a pass from the server, with its warning.)
    log(
      `error: Build #${status.build.number} failed to process: ${status.errorMessage ?? 'the server gave no reason'}`,
    )
    if (status.outcome.warning) log(`warning: ${status.outcome.warning}`)
    log(`Details: ${status.build.url}`)
    if (status.outcome.state === 'fail') result.exitCode = 2
    return result
  }
  const c = status.counts
  log(
    `${status.outcome.summary}: ${c.changed} changed, ${c.added} added, ${c.removed} removed, ${c.unchanged} unchanged${c.failed ? `, ${c.failed} couldn't be read` : ''}`,
  )
  if (status.outcome.warning) log(`warning: ${status.outcome.warning}`)
  if (c.failed > 0) {
    // An input problem, not a visual change: no review settles it. It follows the project's
    // blocking setting like a build that failed to process: when the outcome fails the job ends
    // with an error (2) rather than the "needs review" exit (1); otherwise it passes, warned.
    for (const shot of status.unreadable) log(`error: ${shot.name}: ${shot.reason}`)
    log(`Upload the build again with valid PNGs: ${status.build.url}`)
    if (status.outcome.state === 'fail') result.exitCode = 2
    return result
  }
  if (status.outcome.state === 'fail') {
    // With an integration the commit status is the gate and the job doesn't fail on changes (PLAN §7.4).
    if (status.gate === 'exit-code') {
      log(`Review the changes at ${status.build.url}`)
      if (ci.jobUrl) log(`After approving, re-run this job to unblock the merge: ${ci.jobUrl}`)
      result.exitCode = 1
    }
  }
  return result
}

/** Checks `--shard`/`--nonce` and returns what the server needs, or undefined for a whole build. */
function parallelOf(
  shard: upload.Options['shard'],
  env: Record<string, string | undefined>,
): { nonce: string; total: number } | undefined {
  if (!shard) return undefined
  const { index, total } = shard
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    index < 0 ||
    index >= total
  ) {
    throw new UsageError(
      "--shard must look like 1/4: this job's number, then how many jobs there are",
    )
  }
  const nonce = shard.nonce ?? ciRunId(env)
  if (!nonce) {
    throw new UsageError(
      'Could not tell which CI run these shards belong to. Set CIRCI_PARALLEL_NONCE (or --nonce) to the same value in every shard.',
    )
  }
  return { nonce, total }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

async function waitForResult(
  client: ApiClient,
  buildId: string,
  opts: {
    timeoutMs: number
    intervalMs?: number
    gate?: 'status' | 'exit-code'
    onTransient: (err: unknown) => void
  },
): Promise<ApiClient.Status | undefined> {
  const deadline = Date.now() + opts.timeoutMs
  let warned = false
  for (let attempt = 0; ; attempt += 1) {
    let status: ApiClient.Status | undefined
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling
      status = await client.status(buildId, opts.gate)
    } catch (err) {
      // The client already retried; a server that is still down keeps us waiting until the deadline.
      if (!isRetryable(err, true)) throw err
      if (!warned) opts.onTransient(err)
      warned = true
    }
    if (status && status.outcome.state !== 'pending') return status
    const delay = opts.intervalMs ?? pollDelay(attempt)
    if (Date.now() + delay > deadline) return undefined
    // oxlint-disable-next-line no-await-in-loop -- polling interval
    await sleep(delay)
  }
}

/**
 * How long to wait before the next status poll: 500 ms at first, so a build that finishes in a
 * moment is seen at once, growing by half each time to a ceiling of 2 s, so a long build is not
 * hammered. `attempt` counts from 0.
 */
export function pollDelay(attempt: number): number {
  return Math.min(2_000, Math.round(500 * 1.5 ** attempt))
}

function uniqueFiles(shots: collectScreenshots.Screenshot[]) {
  const seen = new Map<string, { sha256: string; size: number; contentType: string }>()
  for (const s of shots)
    seen.set(s.sha256, { sha256: s.sha256, size: s.size, contentType: 'image/png' })
  return [...seen.values()]
}

async function sendAll(
  client: ApiClient,
  instructions: ApiClient.UploadInstruction[],
  byHash: Map<string, collectScreenshots.Screenshot>,
  log: (line: string) => void,
): Promise<void> {
  let done = 0
  // A line per quarter, so a long upload shows life in a CI log without a line per file.
  const step = Math.max(1, Math.ceil(instructions.length / 4))
  await mapLimit(instructions, UPLOAD_CONCURRENCY, async (instruction) => {
    const shot = byHash.get(instruction.sha256)
    if (!shot) throw new Error(`Server asked for unknown file ${instruction.sha256}`)
    await client.upload(instruction, await readFile(shot.path))
    done += 1
    if (instructions.length > 4 && (done % step === 0 || done === instructions.length)) {
      log(`  uploaded ${done} of ${instructions.length}`)
    }
  })
}

function missingFrom(err: unknown): string[] | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined
  const body = err.body
  if (
    typeof body !== 'object' ||
    body === null ||
    !('missing' in body) ||
    !Array.isArray(body.missing)
  ) {
    return undefined
  }
  return body.missing.filter((m): m is string => typeof m === 'string')
}
