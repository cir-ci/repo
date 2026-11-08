import { createHash } from 'node:crypto'

import { openSecret } from '@circi/core'
import {
  claimDelivery,
  type Database,
  findMemberByProviderAccount,
  findProjectsByHostRepo,
  latestBuildsForPr,
} from '@circi/db'
import {
  type GitlabProvider,
  gitlabWebhookVerifier,
  headerValue,
  parseCommand,
  type GitProvider,
} from '@circi/providers'
import { recordPullRequestAuthor, requeueBuild, reviewBuild } from '@circi/services'
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'

/**
 * `POST /webhooks/gitlab`: what a GitLab project or group webhook tells CirCI. Two events matter:
 * a merge request opened or reopened (its author is remembered, as for GitHub pull requests), and
 * a note on a merge request saying `/circi approve|reject|rerun`. Everything else is acknowledged
 * and ignored.
 *
 * GitLab sends the webhook's secret token in `X-Gitlab-Token` (no signature of the body), so the
 * delivery is only as authentic as that secret (derived from the instance secret and shown on the GitLab page, compared in constant
 * time). It is handled once per delivery (`X-Gitlab-Event-UUID`) and acts only for GitLab users
 * who signed in to CirCI with GitLab and belong to the project's organization. GitLab commit
 * statuses have no buttons, so there is no Approve/Reject on the status (`gitlab-status` is
 * reserved in REVIEW_SOURCES); commands in notes are the way to review from GitLab.
 */

export namespace gitlabWebhookRoutes {
  export interface Deps {
    db: Database
    secret: string
    /** Answers on merge requests; the handler still works (silently) without it. */
    gitlab: Pick<GitlabProvider, 'react' | 'reply'> | undefined
    /** The instance secret, to open the connections' sealed credentials for answering. */
    authSecret?: string
    /** Defaults to a verifier built from `secret`. */
    verifier?: Pick<GitProvider, 'verifyWebhook'>
    publicOrigin: string
    logger: FastifyBaseLogger
  }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined

export const gitlabWebhookRoutes: FastifyPluginAsync<gitlabWebhookRoutes.Deps> = async (
  app,
  deps,
) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })
  const verifier = deps.verifier ?? gitlabWebhookVerifier(deps.secret)

  app.post('/webhooks/gitlab', async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!verifier.verifyWebhook(raw, req.headers)) {
      return reply.code(401).send({ error: 'Bad token' })
    }
    const event = headerValue(req.headers, 'x-gitlab-event') ?? ''
    // Older GitLab sends no event uuid: the body then identifies the delivery.
    const uuid =
      headerValue(req.headers, 'x-gitlab-event-uuid') ??
      headerValue(req.headers, 'idempotency-key') ??
      createHash('sha256').update(raw).digest('hex')
    if (!(await claimDelivery(deps.db, `gitlab:${uuid}`))) return { ok: true, duplicate: true }

    let payload: Record<string, unknown>
    try {
      payload = record(JSON.parse(raw.toString('utf8')))
    } catch {
      return reply.code(400).send({ error: 'Not JSON' })
    }
    try {
      if (event === 'Merge Request Hook') await onMergeRequest(deps, payload)
      else if (event === 'Note Hook') await onNote(deps, payload)
    } catch (err) {
      // Acknowledge anyway: GitLab would only redeliver the same thing.
      deps.logger.error({ err, event, uuid }, 'gitlab webhook handling failed')
    }
    return { ok: true }
  })
}

/** The project the event is about: its path with namespace, and the host it lives on. */
function repoOf(p: Record<string, unknown>): { ref: string; hostPrefix: string } | undefined {
  const project = record(p.project)
  const ref = str(project.path_with_namespace)
  const webUrl = str(project.web_url)
  if (!ref || !webUrl) return undefined
  try {
    return { ref, hostPrefix: `${new URL(webUrl).host}#` }
  } catch {
    return undefined
  }
}

/** A merge request's author replaces the login CI sent on every build of that merge request. */
async function onMergeRequest(deps: gitlabWebhookRoutes.Deps, p: Record<string, unknown>) {
  const attrs = record(p.object_attributes)
  if (attrs.action !== 'open' && attrs.action !== 'reopen') return
  const repo = repoOf(p)
  const iid = Number(attrs.iid)
  // The user of an open or reopen event is the one who did it; they are the author on open.
  const user = record(p.user)
  const login = str(user.username)
  if (!repo || !login || !Number.isInteger(iid)) return
  const projects = await findProjectsByHostRepo(deps.db, 'gitlab', repo.hostPrefix, repo.ref)
  await Promise.all(
    projects.map((project) =>
      recordPullRequestAuthor(deps.db, {
        projectId: project.id,
        prNumber: iid,
        login,
        providerId: str(attrs.author_id) ?? str(user.id) ?? null,
        provider: 'gitlab',
      }),
    ),
  )
}

const LINK_HELP = (origin: string) =>
  `I couldn't tell who you are in CirCI. Sign in at ${origin} with GitLab (a member of this project's organization), then try again.`

async function onNote(deps: gitlabWebhookRoutes.Deps, p: Record<string, unknown>) {
  const attrs = record(p.object_attributes)
  if (attrs.noteable_type !== 'MergeRequest') return
  // Edits of a note arrive as updates: act on the first mention only.
  if (attrs.action !== undefined && attrs.action !== 'create') return
  const command = parseCommand(str(attrs.note) ?? '')
  if (!command) return
  const repo = repoOf(p)
  const iid = Number(record(p.merge_request).iid)
  const noteId = str(attrs.id)
  const actorId = str(record(p.user).id)
  if (!repo || !Number.isInteger(iid) || !noteId || !actorId) return

  const projects = await findProjectsByHostRepo(deps.db, 'gitlab', repo.hostPrefix, repo.ref)
  let acted = false
  let refused = false
  let credentials: string | undefined
  for (const project of projects) {
    if (project.encryptedCredentials && deps.authSecret) {
      credentials ??= openSecret(deps.authSecret, project.encryptedCredentials)
    }
    // eslint-disable-next-line no-await-in-loop -- one repository rarely feeds several projects
    const userId = await findMemberByProviderAccount(deps.db, 'gitlab', actorId, project.id)
    // eslint-disable-next-line no-await-in-loop
    const builds = await latestBuildsForPr(deps.db, project.id, iid)
    if (builds.length === 0) continue
    if (!userId) {
      refused = true
      continue
    }
    for (const build of builds) {
      try {
        if (command === 'rerun') {
          // eslint-disable-next-line no-await-in-loop -- few builds per commit
          await requeueBuild(deps.db, build.id)
        } else if (build.conclusion === 'changes_detected') {
          // eslint-disable-next-line no-await-in-loop
          await reviewBuild(deps.db, {
            buildId: build.id,
            userId,
            state: command === 'approve' ? 'approved' : 'rejected',
            source: 'gitlab-comment',
          })
        } else {
          continue
        }
        acted = true
      } catch (err) {
        deps.logger.info({ err, buildId: build.id, command }, 'gitlab command not applicable')
      }
    }
  }
  if (!deps.gitlab || !credentials) return
  try {
    if (acted) await deps.gitlab.react(repo.ref, iid, noteId, 'thumbsup', credentials)
    else if (refused)
      await deps.gitlab.reply(repo.ref, iid, LINK_HELP(deps.publicOrigin), credentials)
    else await deps.gitlab.react(repo.ref, iid, noteId, 'thumbsdown', credentials)
  } catch (err) {
    deps.logger.warn({ err }, 'could not answer on the merge request')
  }
}
