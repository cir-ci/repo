/**
 * Reads build context from CI environment variables (PLAN §7.1 step 2). Pure: takes the env and
 * a JSON reader, so every provider is covered by table-driven tests.
 */

/**
 * An id shared by every job of one CI run, so the shards of a parallel build find each other.
 * `undefined` when the CI isn't recognised (pass `--nonce` or `CIRCI_PARALLEL_NONCE` then).
 */
export function ciRunId(env: Record<string, string | undefined>): string | undefined {
  const pick = (...names: string[]) => names.map((n) => env[n]).find((v) => v)
  const base = pick(
    'CIRCI_PARALLEL_NONCE',
    'GITHUB_RUN_ID',
    'CI_PIPELINE_ID',
    'BUILDKITE_BUILD_ID',
    'CIRCLE_WORKFLOW_ID',
    'BITBUCKET_BUILD_NUMBER',
    'BUILD_TAG',
    'BUILD_ID',
    'BUILD_BUILDID',
  )
  // A re-run of a GitHub job is a new attempt and must not join the old build.
  return base && env.GITHUB_RUN_ATTEMPT && !env.CIRCI_PARALLEL_NONCE
    ? `${base}-${env.GITHUB_RUN_ATTEMPT}`
    : base
}

export interface CiContext {
  provider:
    | 'github'
    | 'gitea'
    | 'gitlab'
    | 'bitbucket'
    | 'circleci'
    | 'buildkite'
    | 'jenkins'
    | 'azure'
    | 'local'
  /** The commit that was built. For PRs this is the PR's head, never a synthetic merge commit. */
  commitSha?: string
  branch?: string
  prNumber?: number
  /** Branch the PR targets. */
  baseBranch?: string
  /** The PR comes from a fork (PLAN §7.6: forks never move branch links). */
  fromFork?: boolean
  /** Link to the CI job, for "re-run to unblock" messages. */
  jobUrl?: string
}

type Env = Record<string, string | undefined>
type ReadJson = (path: string) => unknown

export function detectCi(env: Env, readJson: ReadJson): CiContext {
  const ctx = detectProvider(env, readJson)
  return applyOverrides(ctx, env)
}

function detectProvider(env: Env, readJson: ReadJson): CiContext {
  if (env.GITHUB_ACTIONS === 'true')
    return github(env, readJson, env.GITEA_ACTIONS === 'true' ? 'gitea' : 'github')
  if (env.GITLAB_CI === 'true') return gitlab(env)
  if (env.BITBUCKET_BUILD_NUMBER) return bitbucket(env)
  if (env.CIRCLECI === 'true') return circleci(env)
  if (env.BUILDKITE === 'true') return buildkite(env)
  if (env.JENKINS_URL) return jenkins(env)
  if (env.TF_BUILD === 'True' || env.TF_BUILD === 'true') return azure(env)
  return { provider: 'local' }
}

function github(env: Env, readJson: ReadJson, provider: 'github' | 'gitea'): CiContext {
  const jobUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined
  const isPr =
    env.GITHUB_EVENT_NAME === 'pull_request' || env.GITHUB_EVENT_NAME === 'pull_request_target'
  if (isPr && env.GITHUB_EVENT_PATH) {
    const pr = field(readJson(env.GITHUB_EVENT_PATH), 'pull_request')
    const head = field(pr, 'head')
    const base = field(pr, 'base')
    const headRepo = str(field(field(head, 'repo'), 'full_name'))
    const baseRepo = str(field(field(base, 'repo'), 'full_name'))
    return {
      provider,
      // GITHUB_SHA is the synthetic merge commit on PR events; the head SHA is what was pushed.
      commitSha: str(field(head, 'sha')) ?? env.GITHUB_SHA,
      branch: str(field(head, 'ref')) ?? env.GITHUB_HEAD_REF,
      prNumber: num(field(pr, 'number')),
      baseBranch: str(field(base, 'ref')) ?? env.GITHUB_BASE_REF,
      fromFork: headRepo && baseRepo ? headRepo !== baseRepo : undefined,
      jobUrl,
    }
  }
  return {
    provider,
    commitSha: env.GITHUB_SHA,
    branch: env.GITHUB_REF_TYPE === 'branch' ? env.GITHUB_REF_NAME : undefined,
    jobUrl,
  }
}

function gitlab(env: Env): CiContext {
  if (env.CI_MERGE_REQUEST_IID) {
    return {
      provider: 'gitlab',
      commitSha: nonEmpty(env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA) ?? env.CI_COMMIT_SHA,
      branch: env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME,
      prNumber: num(env.CI_MERGE_REQUEST_IID),
      baseBranch: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
      fromFork:
        env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID && env.CI_MERGE_REQUEST_PROJECT_ID
          ? env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID !== env.CI_MERGE_REQUEST_PROJECT_ID
          : undefined,
      jobUrl: env.CI_JOB_URL,
    }
  }
  return {
    provider: 'gitlab',
    commitSha: env.CI_COMMIT_SHA,
    branch: env.CI_COMMIT_BRANCH,
    jobUrl: env.CI_JOB_URL,
  }
}

function bitbucket(env: Env): CiContext {
  return {
    provider: 'bitbucket',
    commitSha: env.BITBUCKET_COMMIT,
    branch: env.BITBUCKET_BRANCH,
    prNumber: num(env.BITBUCKET_PR_ID),
    baseBranch: env.BITBUCKET_PR_DESTINATION_BRANCH,
    jobUrl: env.BITBUCKET_GIT_HTTP_ORIGIN
      ? `${env.BITBUCKET_GIT_HTTP_ORIGIN}/addon/pipelines/home#!/results/${env.BITBUCKET_BUILD_NUMBER}`
      : undefined,
  }
}

function circleci(env: Env): CiContext {
  return {
    provider: 'circleci',
    commitSha: env.CIRCLE_SHA1,
    branch: env.CIRCLE_BRANCH,
    prNumber: num(env.CIRCLE_PULL_REQUEST?.match(/\/(\d+)$/)?.[1]),
    jobUrl: env.CIRCLE_BUILD_URL,
  }
}

function buildkite(env: Env): CiContext {
  const pr = env.BUILDKITE_PULL_REQUEST
  return {
    provider: 'buildkite',
    commitSha: env.BUILDKITE_COMMIT,
    branch: env.BUILDKITE_BRANCH,
    prNumber: pr && pr !== 'false' ? num(pr) : undefined,
    baseBranch: pr && pr !== 'false' ? nonEmpty(env.BUILDKITE_PULL_REQUEST_BASE_BRANCH) : undefined,
    jobUrl: env.BUILDKITE_BUILD_URL,
  }
}

function jenkins(env: Env): CiContext {
  const isPr = Boolean(env.CHANGE_ID)
  return {
    provider: 'jenkins',
    commitSha: env.GIT_COMMIT,
    // Multibranch PR jobs set BRANCH_NAME to "PR-12"; the real branch is CHANGE_BRANCH.
    branch: isPr
      ? env.CHANGE_BRANCH
      : (env.BRANCH_NAME ?? env.GIT_BRANCH?.replace(/^origin\//, '')),
    prNumber: num(env.CHANGE_ID),
    baseBranch: isPr ? env.CHANGE_TARGET : undefined,
    jobUrl: env.BUILD_URL,
  }
}

function azure(env: Env): CiContext {
  const pr = num(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER ?? env.SYSTEM_PULLREQUEST_PULLREQUESTID)
  const jobUrl =
    env.SYSTEM_COLLECTIONURI && env.SYSTEM_TEAMPROJECT && env.BUILD_BUILDID
      ? `${env.SYSTEM_COLLECTIONURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`
      : undefined
  if (pr) {
    return {
      provider: 'azure',
      commitSha: env.SYSTEM_PULLREQUEST_SOURCECOMMITID ?? env.BUILD_SOURCEVERSION,
      branch: stripRef(env.SYSTEM_PULLREQUEST_SOURCEBRANCH),
      prNumber: pr,
      baseBranch: stripRef(env.SYSTEM_PULLREQUEST_TARGETBRANCH),
      fromFork: env.SYSTEM_PULLREQUEST_ISFORK
        ? env.SYSTEM_PULLREQUEST_ISFORK === 'True'
        : undefined,
      jobUrl,
    }
  }
  return {
    provider: 'azure',
    commitSha: env.BUILD_SOURCEVERSION,
    branch: stripRef(env.BUILD_SOURCEBRANCH),
    jobUrl,
  }
}

/** `CIRCI_*` variables win over anything detected, for CIs we don't know or odd setups. */
function applyOverrides(ctx: CiContext, env: Env): CiContext {
  return {
    ...ctx,
    commitSha: nonEmpty(env.CIRCI_COMMIT) ?? ctx.commitSha,
    branch: nonEmpty(env.CIRCI_BRANCH) ?? ctx.branch,
    prNumber: num(env.CIRCI_PR_NUMBER) ?? ctx.prNumber,
    baseBranch: nonEmpty(env.CIRCI_BASE_BRANCH) ?? ctx.baseBranch,
  }
}

function field(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined
  const value: unknown = Reflect.get(obj, key)
  return value
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}
function nonEmpty(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === '' ? undefined : v.trim()
}

function stripRef(ref: string | undefined): string | undefined {
  return ref?.replace(/^refs\/heads\//, '')
}
