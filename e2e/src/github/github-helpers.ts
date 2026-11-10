import type { Build } from '@circi/api'

import {
  type Account,
  addMemberViaCli,
  approveBuild,
  createTeam,
  createUserViaCli,
} from '#clients/admin.ts'
import type { Session } from '#clients/admin.ts'
import { uploadBuild, type uploadOrThrow } from '#clients/upload.ts'
import type { ScreenshotSpec } from '#stack/images.ts'
import type { Stack } from '#stack/stack.ts'

import { Repo } from './git-repo.ts'

let installationCounter = 0
/**
 * A GitHub App installation id no other test file, worker process or earlier run uses. One
 * installation belongs to one workspace, so files running in parallel (each with a workspace of
 * its own) must not share one: connecting it twice answers 409 'GitHub account already connected'.
 */
export function uniqueInstallationId(): string {
  installationCounter += 1
  return `${process.pid}${Date.now() % 10_000_000}${installationCounter}`
}

/** A team linked to `repoRef` through the GitHub App, with a baseline uploaded on `main`. */
export interface LinkedTeam {
  workspace: string
  slug: string
  token: string
  repoRef: string
  /** The installation the team's repository is linked through. */
  installationId: string
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
  const installationId = options.installationId ?? uniqueInstallationId()
  await session.put(`/api/teams/${workspace}/${team.slug}/github`, {
    installationId,
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
    installationId,
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
  options: {
    githubUserId: string
    workspace?: string
    role?: 'owner' | 'admin' | 'member'
    /** Teams of `workspace` (slugs) to put them in: a plain member only acts on teams they are in. */
    teams?: string[]
  },
): Promise<Account> {
  const account = await createUserViaCli(stack)
  if (options.workspace)
    await addMemberViaCli(stack, options.workspace, account.email, options.role ?? 'member')
  if (options.workspace && options.teams?.length) {
    const slugs = options.teams.map((t) => `'${t}'`).join(', ')
    await stack.sql(
      `insert into team_members (team_id, user_id) select t.id, u.id from teams t join workspace w on w.id = t.workspace_id, "user" u where w.slug = '${options.workspace}' and t.slug in (${slugs}) and u.email = '${account.email}'`,
    )
  }
  await linkGithubIdentity(stack, account.email, options.githubUserId)
  return account
}

export const checkRunPayload = (
  checkRunId: number,
  repoRef: string,
  identifier: 'approve' | 'reject',
  sender: { id: number; login: string },
  installationId: string,
) => ({
  action: 'requested_action',
  requested_action: { identifier },
  check_run: { id: checkRunId },
  repository: { full_name: repoRef },
  installation: { id: Number(installationId) },
  sender,
})

export const commentPayload = (
  repoRef: string,
  prNumber: number,
  commentId: number,
  body: string,
  user: { id: number; login: string },
  installationId: string,
) => ({
  action: 'created',
  issue: { number: prNumber, pull_request: { url: 'x' } },
  comment: { id: commentId, body, user: { ...user, type: 'User' } },
  repository: { full_name: repoRef },
  installation: { id: Number(installationId) },
  sender: user,
})
