import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { ApiClient, ApiError } from './api.ts'
import { ciRunId, detectCi } from './ci-env.ts'
import { collectScreenshots } from './files.ts'
import { collectAncestry, gitRunner, localHead } from './git.ts'

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
    /** Allow `git fetch` to complete shallow history (default true). */
    fetch?: boolean
    cwd?: string
    env?: Record<string, string | undefined>
    fetchImpl?: typeof fetch
    log?: (line: string) => void
  }

  export interface Result {
    /** 0 pass, 1 the result should block the merge, 2 something went wrong. */
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
  const client = new ApiClient({
    baseUrl: options.apiUrl,
    token: options.token,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  })

  const shots = await collectScreenshots(options.dir)
  if (shots.length === 0) throw new UsageError(`No .png files found in ${options.dir}`)

  const project = await client.project()
  const git = gitRunner(cwd)
  const ci = detectCi(env, (path) => JSON.parse(readFileSync(path, 'utf8')))
  if (options.author?.trim()) ci.author = { login: options.author.trim() }
  if (!ci.commitSha || !ci.branch) {
    const local = await localHead(git)
    ci.commitSha ??= local.sha
    // A detached checkout reports no branch, so this only fills in a real one.
    if (!ci.branch && local.branch) ci.branch = local.branch
  }
  if (!ci.commitSha) {
    throw new UsageError(
      'Could not determine the commit. Run inside a git checkout or set CIRCI_COMMIT.',
    )
  }

  const isBaseBranchBuild = !ci.prNumber && ci.branch === project.defaultBranch
  const ancestry = await collectAncestry(git, {
    headSha: ci.commitSha,
    baseBranch: ci.baseBranch ?? project.defaultBranch,
    isBaseBranchBuild,
    fetch: options.fetch ?? true,
  })
  if (ancestry.warning) {
    log(
      `warning: ${ancestry.warning}. CirCI will compare against the latest ${project.defaultBranch} build instead.`,
    )
  }

  let parallel: { nonce: string; total: number } | undefined
  if (options.shard) {
    const { index, total } = options.shard
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
    const nonce = options.shard.nonce ?? ciRunId(env)
    if (!nonce) {
      throw new UsageError(
        'Could not tell which CI run these shards belong to. Set CIRCI_PARALLEL_NONCE (or --nonce) to the same value in every shard.',
      )
    }
    parallel = { nonce, total }
  }

  log(
    `Uploading ${shots.length} screenshot(s) for ${ci.commitSha.slice(0, 12)}` +
      (ci.branch ? ` on ${ci.branch}` : '') +
      (ci.prNumber ? ` (PR #${ci.prNumber})` : ''),
  )
  const { build, uploads } = await client.createBuild({
    commitSha: ci.commitSha,
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
  await sendAll(client, uploads, byHash)
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
    await sendAll(
      client,
      uploads.filter((u) => missing.includes(u.sha256)),
      byHash,
    )
    await client.finalize(build.id, finalizeBody)
  }
  const deduplicated = new Set(shots.map((s) => s.sha256)).size - uploads.length
  log(`Build #${build.number}: ${build.url}`)
  if (options.shard) {
    log(`  shard ${options.shard.index + 1} of ${options.shard.total} uploaded`)
  }
  log(`  ${uploads.length} uploaded, ${deduplicated} already on the server`)

  const result: upload.Result = {
    exitCode: 0,
    build,
    ci,
    ancestry,
    uploaded: uploads.length,
    deduplicated,
  }
  if (!options.wait) return result

  const status = await waitForResult(client, build.id, {
    timeoutMs: options.waitTimeoutMs ?? 10 * 60_000,
    ...(options.pollIntervalMs !== undefined ? { intervalMs: options.pollIntervalMs } : {}),
    ...(options.gate ? { gate: options.gate } : {}),
  })
  result.status = status
  if (!status) {
    log('error: timed out waiting for the build to be processed')
    result.exitCode = 2
    return result
  }
  const c = status.counts
  log(
    `${status.outcome.summary}: ${c.changed} changed, ${c.added} added, ${c.removed} removed, ${c.unchanged} unchanged${c.failed ? `, ${c.failed} failed` : ''}`,
  )
  if (status.outcome.warning) log(`warning: ${status.outcome.warning}`)
  if (status.outcome.state === 'fail') {
    // With an integration the commit status is the gate and only errors fail the job (PLAN §7.4).
    const blocks = status.gate === 'exit-code' || status.build.status === 'error'
    if (blocks) {
      log(`Review the changes at ${status.build.url}`)
      if (ci.jobUrl) log(`After approving, re-run this job to unblock the merge: ${ci.jobUrl}`)
      result.exitCode = 1
    }
  }
  return result
}

async function waitForResult(
  client: ApiClient,
  buildId: string,
  opts: { timeoutMs: number; intervalMs?: number; gate?: 'status' | 'exit-code' },
): Promise<ApiClient.Status | undefined> {
  const deadline = Date.now() + opts.timeoutMs
  for (let attempt = 0; ; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    const status = await client.status(buildId, opts.gate)
    if (status.outcome.state !== 'pending') return status
    const delay = opts.intervalMs ?? pollDelay(attempt)
    if (Date.now() + delay > deadline) return undefined
    // oxlint-disable-next-line no-await-in-loop -- polling interval
    await new Promise((r) => setTimeout(r, delay))
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
): Promise<void> {
  let next = 0
  const lanes = Array.from(
    { length: Math.min(UPLOAD_CONCURRENCY, instructions.length) },
    async () => {
      while (next < instructions.length) {
        const instruction = instructions[next]
        next += 1
        if (!instruction) continue
        const shot = byHash.get(instruction.sha256)
        if (!shot) throw new Error(`Server asked for unknown file ${instruction.sha256}`)
        // oxlint-disable-next-line no-await-in-loop -- each lane uploads one file at a time
        await client.upload(instruction, await readFile(shot.path))
      }
    },
  )
  await Promise.all(lanes)
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

/** A problem with how the CLI was called or configured (exit code 2, no stack trace). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}
