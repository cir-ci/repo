import type { Build } from '@circi/api'

import {
  type Account,
  addMemberViaCli,
  approveBuild,
  createTeam,
  createUserViaCli,
} from './admin.ts'
import type { Session } from './admin.ts'
import { Repo } from './git-repo.ts'
import type { ScreenshotSpec } from './images.ts'
import type { Stack } from './stack.ts'
import { uploadBuild, type uploadOrThrow } from './upload.ts'

/** The fake's installation id used by these tests. */
export const INSTALLATION = '4242'

/** A team linked to `repoRef` through the GitHub App, with a baseline uploaded on `main`. */
export interface LinkedTeam {
  workspace: string
  slug: string
  token: string
  repoRef: string
  repo: Repo
  /** The commit of the baseline on main. */
  baselineSha: string
}

export interface PrBuild {
  sha: string
  number: number
  buildNumber: number
  buildId: string
  upload: uploadOrThrow.Result | undefined
  exitCode: number
}

/**
 * A new team in the first workspace, linked to a fake repository, with a two-screenshot
 * baseline (`home`, `login`) uploaded from `main`.
 */
export async function createLinkedTeam(
  stack: Stack,
  session: Session,
  workspace: string,
  name: string,
  options: { repoRef: string; blockMergeOnChanges?: boolean; installationId?: string },
): Promise<LinkedTeam> {
  const team = await createTeam(session, workspace, name)
  await session.put(`/api/teams/${workspace}/${team.slug}/github`, {
    installationId: options.installationId ?? INSTALLATION,
    repoRef: options.repoRef,
  })
  if (options.blockMergeOnChanges !== undefined) {
    await session.patch(`/api/teams/${workspace}/${team.slug}/settings`, {
      blockMergeOnChanges: options.blockMergeOnChanges,
    })
  }
  const repo = await Repo.create()
  await repo.writeShots({ home: {}, login: { dot: { x: 40, y: 40 } } })
  const baselineSha = await repo.commit('baseline')
  const up = await uploadBuild({ stack, token: team.token, repo, wait: true })
  if (up.exitCode !== 0) throw new Error(`baseline upload failed: ${up.stderr}\n${up.stdout}`)
  // The first build has no baseline, so it waits for review: approve it to make it the baseline.
  await approveBuild(session, workspace, team.slug, up.result?.build.number ?? 0)
  return {
    workspace,
    slug: team.slug,
    token: team.token,
    repoRef: options.repoRef,
    repo,
    baselineSha,
  }
}

/**
 * A pull request build: branches off `main`, writes `shots` over the baseline, commits and uploads
 * with `circi upload --wait`.
 */
export async function uploadPr(
  stack: Stack,
  p: LinkedTeam,
  prNumber: number,
  shots: Record<string, ScreenshotSpec | Buffer>,
  options: Partial<Pick<uploadBuild.Options, 'gate' | 'wait' | 'args'>> & { branch?: string } = {},
): Promise<PrBuild> {
  await p.repo.checkout('main')
  await p.repo.checkout(options.branch ?? `pr-${prNumber}-${Date.now()}`, { create: true })
  await p.repo.writeShots(shots)
  const sha = await p.repo.commit(`change for #${prNumber}`)
  await p.repo.fetch()
  const run = await uploadBuild({
    stack,
    token: p.token,
    repo: p.repo,
    wait: options.wait ?? true,
    pr: { number: prNumber },
    ...(options.gate ? { gate: options.gate } : {}),
    ...(options.args ? { args: options.args } : {}),
  })
  return {
    sha,
    number: prNumber,
    buildNumber: run.result?.build.number ?? 0,
    buildId: run.result?.build.id ?? '',
    upload: run.result,
    exitCode: run.exitCode,
  }
}

export const buildDetail = (session: Session, p: { workspace: string; slug: string }, n: number) =>
  session.get<Build.Detail>(`/api/teams/${p.workspace}/${p.slug}/builds/${n}`)

/** Links a CirCI user to a GitHub login the way "link GitHub" on the Account page does (an `account` row). */
export async function linkGithubIdentity(
  stack: Stack,
  email: string,
  githubUserId: string,
): Promise<void> {
  const rows = await stack.sql(`select id from "user" where email = '${email}'`)
  const userId = rows[0]?.[0]
  if (!userId) throw new Error(`no user ${email}`)
  await stack.sql(
    `insert into account (id, account_id, provider_id, user_id, created_at, updated_at) values ('gh-${githubUserId}-${userId}', '${githubUserId}', 'github', '${userId}', now(), now())`,
  )
}

/** A CirCI user (optionally a member of `workspace`) whose GitHub identity is `githubUserId`. */
export async function createGithubUser(
  stack: Stack,
  options: { githubUserId: string; workspace?: string; role?: 'owner' | 'admin' | 'member' },
): Promise<Account> {
  const account = await createUserViaCli(stack)
  if (options.workspace)
    await addMemberViaCli(stack, options.workspace, account.email, options.role ?? 'member')
  await linkGithubIdentity(stack, account.email, options.githubUserId)
  return account
}

export const checkRunPayload = (
  checkRunId: number,
  repoRef: string,
  identifier: 'approve' | 'reject',
  sender: { id: number; login: string },
) => ({
  action: 'requested_action',
  requested_action: { identifier },
  check_run: { id: checkRunId },
  repository: { full_name: repoRef },
  installation: { id: Number(INSTALLATION) },
  sender,
})

export const commentPayload = (
  repoRef: string,
  prNumber: number,
  commentId: number,
  body: string,
  user: { id: number; login: string },
) => ({
  action: 'created',
  issue: { number: prNumber, pull_request: { url: 'x' } },
  comment: { id: commentId, body, user: { ...user, type: 'User' } },
  repository: { full_name: repoRef },
  installation: { id: Number(INSTALLATION) },
  sender: user,
})
