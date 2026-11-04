import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import {
  ApiClient,
  ApiError,
  type BuildStatus,
  type BuildSummary,
  type UploadInstruction,
} from './api.ts'
import { type CiContext, detectCi } from './ci-env.ts'
import { collectScreenshots, type LocalScreenshot } from './files.ts'
import { type Ancestry, collectAncestry, gitRunner, localHead } from './git.ts'

export interface UploadOptions {
  dir: string
  apiUrl: string
  token: string
  /** Build name, for several kinds of builds per commit (e.g. `chromium`, `mobile`). */
  name?: string
  wait?: boolean
  waitTimeoutMs?: number
  pollIntervalMs?: number
  /** Allow `git fetch` to complete shallow history (default true). */
  fetch?: boolean
  cwd?: string
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

export interface UploadResult {
  /** 0 pass, 1 the result should block the merge, 2 something went wrong. */
  exitCode: 0 | 1 | 2
  build: BuildSummary
  ci: CiContext
  ancestry: Ancestry
  uploaded: number
  deduplicated: number
  status?: BuildStatus
}

const UPLOAD_CONCURRENCY = 8

export async function upload(options: UploadOptions): Promise<UploadResult> {
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
    files: uniqueFiles(shots),
  })

  const byHash = new Map(shots.map((s) => [s.sha256, s]))
  await sendAll(client, uploads, byHash)
  const finalizeBody = {
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
  log(`  ${uploads.length} uploaded, ${deduplicated} already on the server`)

  const result: UploadResult = {
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
    intervalMs: options.pollIntervalMs ?? 2_000,
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
  opts: { timeoutMs: number; intervalMs: number },
): Promise<BuildStatus | undefined> {
  const deadline = Date.now() + opts.timeoutMs
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    const status = await client.status(buildId)
    if (status.outcome.state !== 'pending') return status
    if (Date.now() + opts.intervalMs > deadline) return undefined
    // oxlint-disable-next-line no-await-in-loop -- polling interval
    await new Promise((r) => setTimeout(r, opts.intervalMs))
  }
}

function uniqueFiles(shots: LocalScreenshot[]) {
  const seen = new Map<string, { sha256: string; size: number; contentType: string }>()
  for (const s of shots)
    seen.set(s.sha256, { sha256: s.sha256, size: s.size, contentType: 'image/png' })
  return [...seen.values()]
}

async function sendAll(
  client: ApiClient,
  instructions: UploadInstruction[],
  byHash: Map<string, LocalScreenshot>,
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
