import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export namespace gitRunner {
  export interface Runner {
    /** Runs git and returns trimmed stdout; throws on a non-zero exit. */
    run(args: string[]): Promise<string>
  }
}

export function gitRunner(cwd: string): gitRunner.Runner {
  return {
    async run(args) {
      const { stdout } = await exec('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
      return stdout.trim()
    },
  }
}

async function tryRun(git: gitRunner.Runner, args: string[]): Promise<string | undefined> {
  try {
    return await git.run(args)
  } catch {
    return undefined
  }
}

export namespace collectAncestry {
  export interface Options {
    /** The commit being uploaded: the PR head, never a synthetic merge commit (PLAN §7.1). */
    headSha: string
    /** Branch whose history holds the baselines: the PR's base, or the project's default branch. */
    baseBranch: string
    /** True for builds on the default branch itself: history starts at the head's parent. */
    isBaseBranchBuild: boolean
    remote?: string
    /** Fetch missing history from the remote (default true). */
    fetch?: boolean
    /** How many commits to send. */
    limit?: number
    /** Stop deepening a shallow clone after this many commits. */
    maxDepth?: number
  }

  export interface Result {
    status: 'ok' | 'missing' | 'truncated'
    mergeBaseSha?: string
    /** Nearest first. */
    ancestorShas: string[]
    /** Why history is missing or truncated, for the CLI to print. */
    warning?: string
  }
}

const DEEPEN_STEP = 200

/**
 * Collects the history the server uses to pick a baseline (PLAN §7.1 step 3, §7.2), so baseline
 * selection never depends on a git host's API.
 */
export async function collectAncestry(
  git: gitRunner.Runner,
  options: collectAncestry.Options,
): Promise<collectAncestry.Result> {
  const remote = options.remote ?? 'origin'
  const limit = options.limit ?? 200
  const maxDepth = options.maxDepth ?? 2_000
  const doFetch = options.fetch ?? true
  if ((await tryRun(git, ['rev-parse', '--is-inside-work-tree'])) !== 'true') {
    return { status: 'missing', ancestorShas: [], warning: 'Not inside a git repository' }
  }
  const head = options.headSha

  if (!(await hasCommit(git, head)) && doFetch) {
    await tryRun(git, ['fetch', '--no-tags', ...(await depthArgs(git)), remote, head])
  }
  if (!(await hasCommit(git, head))) {
    return {
      status: 'missing',
      ancestorShas: [],
      warning: `Commit ${head} is not available locally`,
    }
  }

  if (options.isBaseBranchBuild) {
    // The merge-base of a default-branch build is the head itself; baselines are its ancestors.
    // In a shallow checkout (e.g. depth 1) the parent may not be there yet: deepen until it is.
    const parents = await withDeepening(git, {
      rounds: doFetch ? Math.floor(maxDepth / DEEPEN_STEP) : 0,
      attempt: () => listFirstParent(git, `${head}~1`, limit),
      deepen: () => tryRun(git, ['fetch', '--no-tags', `--deepen=${DEEPEN_STEP}`, remote, head]),
    })
    if (parents === undefined) {
      const root = (await tryRun(git, ['rev-list', '--max-parents=0', head]))?.split('\n') ?? []
      if (root.includes(head)) return { status: 'ok', mergeBaseSha: head, ancestorShas: [] }
      return {
        status: 'missing',
        ancestorShas: [],
        warning: 'Could not read the commit history (shallow clone)',
      }
    }
    return {
      status: await statusFor(git, parents, limit),
      mergeBaseSha: head,
      ancestorShas: parents,
    }
  }

  // PR / feature branch: find where it forked from the base branch.
  const baseRef = `refs/remotes/${remote}/${options.baseBranch}`
  if (doFetch) {
    // CI checkouts often lack the base branch entirely (GitHub's default fetches only the PR).
    await tryRun(git, [
      'fetch',
      '--no-tags',
      ...(await depthArgs(git)),
      remote,
      `+refs/heads/${options.baseBranch}:${baseRef}`,
    ])
  }
  if (!(await tryRun(git, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]))) {
    return {
      status: 'missing',
      ancestorShas: [],
      warning: `Base branch "${options.baseBranch}" is not available from ${remote}`,
    }
  }

  const mergeBase = await withDeepening(git, {
    rounds: doFetch ? Math.floor(maxDepth / DEEPEN_STEP) : 0,
    attempt: async () => (await tryRun(git, ['merge-base', head, baseRef])) || undefined,
    deepen: () =>
      tryRun(git, [
        'fetch',
        '--no-tags',
        `--deepen=${DEEPEN_STEP}`,
        remote,
        head,
        `+refs/heads/${options.baseBranch}:${baseRef}`,
      ]),
  })
  if (!mergeBase) {
    return {
      status: 'missing',
      ancestorShas: [],
      warning: `No common history with "${options.baseBranch}" within ${maxDepth} commits; use a deeper checkout (e.g. fetch-depth: 0)`,
    }
  }
  const ancestors = (await listFirstParent(git, mergeBase, limit)) ?? [mergeBase]
  return {
    status: await statusFor(git, ancestors, limit),
    mergeBaseSha: mergeBase,
    ancestorShas: ancestors,
  }
}

/** Branch tip on the remote (PLAN §7.6 branch links); undefined if it can't be read. */
export async function remoteBranchTip(
  git: gitRunner.Runner,
  branch: string,
  remote = 'origin',
): Promise<string | undefined> {
  const out = await tryRun(git, ['ls-remote', remote, `refs/heads/${branch}`])
  return out?.split(/\s+/)[0] || undefined
}

/** Whether `ancestor` is HEAD or one of its ancestors (false when it can't be told). */
export async function isAncestor(
  git: gitRunner.Runner,
  ancestor: string,
  head = 'HEAD',
): Promise<boolean> {
  return (await tryRun(git, ['merge-base', '--is-ancestor', ancestor, head])) !== undefined
}

export async function localHead(git: gitRunner.Runner): Promise<{ sha?: string; branch?: string }> {
  const sha = await tryRun(git, ['rev-parse', 'HEAD'])
  const branch = await tryRun(git, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return {
    ...(sha ? { sha } : {}),
    ...(branch && branch !== 'HEAD' ? { branch } : {}),
  }
}

async function hasCommit(git: gitRunner.Runner, sha: string): Promise<boolean> {
  return (await tryRun(git, ['cat-file', '-e', `${sha}^{commit}`])) !== undefined
}

/**
 * `--depth` writes `.git/shallow`: on a full clone it would cut the user's history for good, so
 * only a repository that is already shallow gets it. A full clone fetches what is missing whole.
 */
async function depthArgs(git: gitRunner.Runner): Promise<string[]> {
  return (await isShallow(git)) ? [`--depth=${DEEPEN_STEP}`] : []
}

async function isShallow(git: gitRunner.Runner): Promise<boolean> {
  return (await tryRun(git, ['rev-parse', '--is-shallow-repository'])) === 'true'
}

async function listFirstParent(
  git: gitRunner.Runner,
  rev: string,
  limit: number,
): Promise<string[] | undefined> {
  const out = await tryRun(git, ['rev-list', '--first-parent', `--max-count=${limit}`, rev])
  return out === undefined ? undefined : out.split('\n').filter(Boolean)
}

/** Fewer commits than asked for in a shallow clone means history was cut off, not exhausted. */
async function statusFor(
  git: gitRunner.Runner,
  shas: string[],
  limit: number,
): Promise<'ok' | 'truncated'> {
  return shas.length < limit && (await isShallow(git)) ? 'truncated' : 'ok'
}

/**
 * Tries `attempt`; while it finds nothing and the clone is shallow, fetches more history and
 * tries again, at most `rounds` times. Each step depends on the previous fetch, so it's sequential.
 */
async function withDeepening<T>(
  git: gitRunner.Runner,
  steps: { rounds: number; attempt: () => Promise<T | undefined>; deepen: () => Promise<unknown> },
): Promise<T | undefined> {
  for (let round = 0; ; round += 1) {
    // oxlint-disable-next-line no-await-in-loop -- depends on the previous round's fetch
    const found = await steps.attempt()
    // oxlint-disable-next-line no-await-in-loop -- see above
    if (found !== undefined || round >= steps.rounds || !(await isShallow(git))) return found
    // oxlint-disable-next-line no-await-in-loop -- see above
    await steps.deepen()
  }
}
