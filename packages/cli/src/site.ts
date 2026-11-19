import { lstat } from 'node:fs/promises'

import * as tar from 'tar'

import { ApiClient } from './api.ts'
import { buildContext } from './context.ts'
import { errorLine, UsageError } from './errors.ts'
import { gitRunner, isAncestor, remoteBranchTip } from './git.ts'

export namespace uploadSite {
  export interface Options {
    dir: string
    apiUrl: string
    token: string
    /** Which site of the project this is (`storybook`, `coverage`…). Default `site`. */
    name?: string
    /** `auto` looks at the files. Default `auto`. */
    kind?: string
    /** Serve unknown paths with the entry page (single-page apps). */
    spa?: boolean
    cwd?: string
    env?: Record<string, string | undefined>
    fetchImpl?: typeof fetch
    /** First backoff between retries of a failed API call, in milliseconds (default 500). */
    retryDelayMs?: number
    log?: (line: string) => void
  }

  export interface Result extends ApiClient.SiteUpload {
    archiveBytes: number
  }
}

/** Packs `dir` as a `.tar.gz`, refusing symlinks and special files up front with their names. */
export async function packSite(dir: string): Promise<Buffer> {
  const info = await lstat(dir).catch(() => undefined)
  if (!info?.isDirectory()) throw new UsageError(`${dir} is not a directory`)
  const refused: string[] = []
  const chunks: Buffer[] = []
  const stream = tar.create(
    {
      gzip: true,
      cwd: dir,
      portable: true,
      // Not following links: a link in the site is refused by the server, so say so here.
      filter: (path, entry) => {
        // A `Stats` for the walk of the directory, a `ReadEntry` once it's being written.
        const allowed =
          'type' in entry
            ? entry.type === 'File' || entry.type === 'Directory'
            : entry.isFile() || entry.isDirectory()
        if (!allowed) refused.push(path)
        return true
      },
    },
    ['.'],
  )
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  if (refused.length > 0) {
    const shown = refused.slice(0, 5).join(', ')
    throw new UsageError(
      `${dir} contains symbolic links or special files, which hosted sites can't have: ${shown}${refused.length > 5 ? ', …' : ''}`,
    )
  }
  return Buffer.concat(chunks)
}

/** `circi site upload`: sends a built site and prints where it can be opened. */
export async function uploadSite(options: uploadSite.Options): Promise<uploadSite.Result> {
  const log = options.log ?? ((line: string) => console.log(line))
  const env = options.env ?? process.env
  const git = gitRunner(options.cwd ?? process.cwd())
  const client = new ApiClient({
    baseUrl: options.apiUrl,
    token: options.token,
    fetch: options.fetchImpl,
    retryDelayMs: options.retryDelayMs,
  })
  const name = options.name ?? 'site'
  // Packing is the slow part and needs nothing from git or the server: it runs alongside them.
  const [archive, { ci, query }] = await Promise.all([
    packSite(options.dir),
    siteQuery(options, { env, git, client, name, log }),
  ])
  log(
    `Uploading ${options.dir} (${(archive.length / 1024).toFixed(0)} kB) for ${ci.commitSha.slice(0, 12)}`,
  )
  const result = await client.uploadSite(query, archive)
  log(`${result.site.name} (${result.site.kind}): ${result.version.fileCount} files`)
  log(`  commit:  ${result.addresses.commit}`)
  if (result.addresses.branch) log(`  branch:  ${result.addresses.branch}`)
  else if (ci.branch)
    log(`  The ${ci.branch} address was not moved: this commit isn't the branch's tip.`)
  return { ...result, archiveBytes: archive.length }
}

/** The build's commit and branch, and what the server needs to know to place the upload. */
async function siteQuery(
  options: uploadSite.Options,
  { env, git, client, name, log }: siteQuery.Context,
): Promise<{ ci: Awaited<ReturnType<typeof buildContext>>; query: Record<string, string> }> {
  const ci = await buildContext(env, git)
  // The branch address follows the branch's tip (PLAN §7.6): ask git for it, and if that fails
  // fall back to checking that this commit descends from what the address serves now.
  const query: Record<string, string> = {
    name,
    kind: options.kind ?? 'auto',
    commit: ci.commitSha,
  }
  if (options.spa) query.spa = 'true'
  if (ci.fromFork) query.fork = 'true'
  if (!ci.branch) return { ci, query }
  query.branch = ci.branch
  const tip = await remoteBranchTip(git, ci.branch)
  if (tip) {
    query.branch_tip = tip
    return { ci, query }
  }
  // Only the server's explicit "nothing served yet" (null) says the branch is free to take;
  // when it can't be asked, say nothing and let the server decide.
  let served: string | null | undefined
  try {
    served = await client.servedCommit(name, ci.branch)
  } catch (err) {
    log(`warning: couldn't ask what ${ci.branch} serves now (${errorLine(err)}); continuing`)
  }
  if (served === null || (served && (await isAncestor(git, served)))) query.descends = 'true'
  return { ci, query }
}

namespace siteQuery {
  export interface Context {
    env: Record<string, string | undefined>
    git: gitRunner.Runner
    client: ApiClient
    name: string
    log: (line: string) => void
  }
}
