import { REVIEW_SOURCES, reviewability } from '@circi/core'
import { openSecret } from '@circi/core/node'
import { type Database } from '@circi/db'
import { getProjectById } from '@circi/db/queries'
import {
  clearInstallationNeedsAttention,
  findBuildByCheckRun,
  findGitProjects,
  latestBuildsForPr,
  linkBuildsToPullRequest,
  markInstallationNeedsAttention,
} from '@circi/db/queue'
import {
  closeReviewRequestsForPullRequest,
  findProjectViewersByAccount,
  markBuildNotificationsRead,
} from '@circi/db/repositories'
import type { IntegrationDefinition } from '@circi/integrations'
import type { CommandIgnoredReason } from '@circi/integrations/git'

import { recordPullRequestAuthor, requeueBuild } from '#src/builds/lifecycle.ts'
import { reviewBuild } from '#src/reviews/reviews.ts'

/**
 * The one handler for what a git host's webhook says, whichever host it is. A definition's
 * `git.webhook.events` turns a verified delivery into normalised events (a pull request opened or
 * changed, a `/circi approve|reject|rerun` command, Approve or Reject pressed on a check); this acts
 * on them: remembers a pull request's author, gives builds their pull request number, reviews or
 * reruns the builds of a pull request for the member the host account belongs to, and has the
 * definition answer on the host (a reaction or a reply).
 *
 * Only people who linked their account on the host to a CirCI sign-in and belong to the project's
 * workspace may act (matched by the host's account id, never by email); anyone else is told how
 * to link.
 */

export namespace handleGitEvents {
  export interface Input {
    definition: IntegrationDefinition
    ctx: IntegrationDefinition.Context
    events: readonly IntegrationDefinition.GitEvent[]
    log: {
      info(obj: object, msg: string): void
      warn(obj: object, msg: string): void
    }
  }
}

type ReviewSource = NonNullable<reviewBuild.Input['source']>

/** The review source a kind's comments or check buttons are recorded as (`<kind>-comment`). */
function reviewSource(kind: string, how: 'comment' | 'check'): ReviewSource {
  const found = REVIEW_SOURCES.find((s) => s === `${kind}-${how}`)
  if (!found) throw new Error(`No review source for ${kind} ${how}s`)
  return found
}

/**
 * The one CirCI user the host account is, if they may see the project (a member of it, or an owner
 * or admin of its workspace); otherwise undefined.
 */
async function memberOf(db: Database, projectId: string, kind: string, accountId: string) {
  if (!accountId) return undefined
  const members = await findProjectViewersByAccount(db, projectId, kind, accountId)
  return members.length === 1 ? members[0] : undefined
}

export async function handleGitEvents(db: Database, input: handleGitEvents.Input): Promise<void> {
  for (const event of input.events) {
    // oxlint-disable-next-line no-await-in-loop -- events of one delivery are handled in order
    if (event.type === 'pull_request') await onPullRequest(db, input, event)
    // oxlint-disable-next-line no-await-in-loop
    else if (event.type === 'pull_request_closed') await onPullRequestClosed(db, input, event)
    // oxlint-disable-next-line no-await-in-loop
    else if (event.type === 'connection') await onConnection(db, input, event)
    // oxlint-disable-next-line no-await-in-loop
    else if (event.type === 'command') await onCommand(db, input, event)
    // oxlint-disable-next-line no-await-in-loop
    else await onCheckAction(db, input, event)
  }
}

type Of<T extends IntegrationDefinition.GitEvent['type']> = Extract<
  IntegrationDefinition.GitEvent,
  { type: T }
>

/** The pull request's author replaces the login CI sent on every build of that pull request. */
async function onPullRequest(
  db: Database,
  input: handleGitEvents.Input,
  event: Of<'pull_request'>,
) {
  const kind = input.definition.id
  const projects = await findGitProjects(db, kind, event.repo.connection, event.repo.ref)
  for (const project of projects) {
    const { sha, branch } = event.head ?? {}
    if (sha || branch) {
      // eslint-disable-next-line no-await-in-loop -- one repository rarely feeds several projects
      await linkBuildsToPullRequest(db, {
        projectId: project.id,
        prNumber: event.number,
        ...(sha ? { commitSha: sha } : {}),
        ...(branch ? { branch } : {}),
      })
    }
    if (event.author) {
      // eslint-disable-next-line no-await-in-loop
      await recordPullRequestAuthor(db, {
        projectId: project.id,
        prNumber: event.number,
        login: event.author.login,
        providerId: event.author.accountId ?? null,
        provider: kind,
      })
    }
  }
}

/**
 * A closed or merged pull request ends the review requests on its builds (as dismissed, with
 * their "please review" notices): nobody needs to look at a pull request that is gone. The builds
 * keep their own review state.
 */
async function onPullRequestClosed(
  db: Database,
  input: handleGitEvents.Input,
  event: Of<'pull_request_closed'>,
) {
  const projects = await findGitProjects(db, input.definition.id, event.repo.connection, event.repo.ref)
  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop -- one repository rarely feeds several projects
    await db.transaction(async (tx) => {
      const closed = await closeReviewRequestsForPullRequest(tx, {
        projectId: project.id,
        prNumber: event.number,
      })
      for (const request of closed) {
        // eslint-disable-next-line no-await-in-loop -- one transaction, a few reviewers
        await markBuildNotificationsRead(tx, {
          userId: request.reviewerId,
          buildId: request.buildId,
          kinds: ['review_requested', 'review_re_requested', 'review_overdue'],
        })
      }
    })
  }
}

/** The host removed, suspended or restored the connection: show or clear "needs attention". */
async function onConnection(db: Database, input: handleGitEvents.Input, event: Of<'connection'>) {
  const kind = input.definition.id
  if (event.state === 'revoked') {
    await markInstallationNeedsAttention(
      db,
      kind,
      event.connection.externalId,
      event.reason ?? 'The connection was removed on the host.',
    )
  } else {
    await clearInstallationNeedsAttention(db, kind, event.connection.externalId)
  }
}

async function onCommand(db: Database, input: handleGitEvents.Input, event: Of<'command'>) {
  const { definition, ctx } = input
  const kind = definition.id
  const projects = await findGitProjects(db, kind, event.repo.connection, event.repo.ref)
  let acted = false
  let refused = false
  let reason: CommandIgnoredReason = 'no_build'
  let credentials: string | undefined
  let externalId = 'externalId' in event.repo.connection ? event.repo.connection.externalId : ''
  const source = reviewSource(kind, 'comment')
  for (const project of projects) {
    if (credentials === undefined && project.encryptedCredentials) {
      credentials = openSecret(ctx.authSecret, project.encryptedCredentials)
    }
    externalId = project.externalId
    // eslint-disable-next-line no-await-in-loop -- one repository rarely feeds several projects
    const userId = await memberOf(db, project.id, kind, event.actor.accountId)
    // eslint-disable-next-line no-await-in-loop
    const builds = await latestBuildsForPr(db, project.id, event.number)
    if (builds.length === 0) continue
    if (!userId) {
      refused = true
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const settings = await getProjectById(db, project.id)
    for (const build of builds) {
      try {
        if (event.command === 'rerun') {
          // eslint-disable-next-line no-await-in-loop -- few builds per commit
          await requeueBuild(db, build.id)
        } else {
          const verdict = reviewability(build, {
            autoApproveNoChanges: settings?.autoApproveNoChanges ?? true,
          })
          if (verdict !== 'reviewable') {
            reason = verdict
            continue
          }
          // eslint-disable-next-line no-await-in-loop
          await reviewBuild(db, {
            buildId: build.id,
            userId,
            state: event.command === 'approve' ? 'approved' : 'rejected',
            source,
          })
        }
        acted = true
      } catch (err) {
        reason = 'failed'
        input.log.info(
          { err, buildId: build.id, command: event.command },
          `${kind} command not applicable`,
        )
      }
    }
  }
  await answer(input, {
    event,
    outcome: acted ? 'acted' : refused ? 'refused' : 'ignored',
    ...(acted || refused ? {} : { reason }),
    connection: { externalId, credentials },
  })
}

async function onCheckAction(
  db: Database,
  input: handleGitEvents.Input,
  event: Of<'check_action'>,
) {
  const kind = input.definition.id
  const build = await findBuildByCheckRun(db, event.checkRunId)
  if (!build) return
  const connection = event.repo?.connection
  // A check's answer needs the connection the delivery named (a check button has no stored one).
  const answerWith = (said: Pick<IntegrationDefinition.GitAnswer, 'outcome' | 'reason'>) =>
    event.repo && connection && 'externalId' in connection
      ? answer(input, {
          event,
          ...said,
          ...(build.prNumber === null ? {} : { prNumber: build.prNumber }),
          connection: { externalId: connection.externalId, credentials: undefined },
        })
      : undefined
  const userId = await memberOf(db, build.projectId, kind, event.actor.accountId)
  if (!userId) {
    await answerWith({ outcome: 'refused' })
    return
  }
  const settings = await getProjectById(db, build.projectId)
  const verdict = reviewability(build, {
    autoApproveNoChanges: settings?.autoApproveNoChanges ?? true,
  })
  if (verdict !== 'reviewable') {
    await answerWith({ outcome: 'ignored', reason: verdict })
    return
  }
  await reviewBuild(db, {
    buildId: build.id,
    userId,
    state: event.action === 'approve' ? 'approved' : 'rejected',
    source: reviewSource(kind, 'check'),
  })
}

/** Tells the person on the host what happened; a failure to answer never undoes the work. */
async function answer(input: handleGitEvents.Input, said: IntegrationDefinition.GitAnswer) {
  const git = input.definition.capabilities.git
  if (!git) return
  try {
    await git.respond(said, input.ctx)
  } catch (err) {
    input.log.warn({ err }, `could not answer on ${input.definition.name}`)
  }
}
