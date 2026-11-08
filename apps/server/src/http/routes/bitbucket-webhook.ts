import {
  claimDelivery,
  type Database,
  findBitbucketProjects,
  findMembersByAccount,
  latestBuildsForPr,
  linkBuildsToPullRequest,
  setPullRequestAuthor,
} from '@circi/db'
import { type BitbucketCloud, type GitProvider, parseCommand } from '@circi/providers'
import { requeueBuild, reviewBuild } from '@circi/services'
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'

import { openConnectionCredentials } from '#http/lib/connection-credentials.ts'

/**
 * `POST /webhooks/bitbucket`: what Bitbucket Cloud tells CirCI about pull requests. A created or
 * updated pull request gives its builds their pull request number (matched by commit or source
 * branch) and its author; a comment `/circi approve|reject|rerun` acts on the pull request's
 * latest builds. Everything else is acknowledged and ignored.
 *
 * Deliveries are verified by signature, handled once per request id, and only act for Bitbucket
 * users who linked their Bitbucket account (account id = the user's uuid) to a CirCI account that
 * belongs to the project's organization. Others get a reply saying so.
 */

export namespace bitbucketWebhookRoutes {
  export interface Deps {
    db: Database
    /** Checks the signature, and answers on pull requests (silently skipped when absent). */
    bitbucket: Pick<GitProvider, 'verifyWebhook'> & Partial<Pick<BitbucketCloud, 'reply'>>
    /** Opens the connections' sealed tokens, to answer on pull requests. */
    authSecret?: string
    publicOrigin: string
    logger: FastifyBaseLogger
  }
}

type Payload = Record<string, unknown>

const record = (value: unknown): Payload =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined

export const bitbucketWebhookRoutes: FastifyPluginAsync<bitbucketWebhookRoutes.Deps> = async (
  app,
  deps,
) => {
  // The signature covers the exact bytes, so keep them: parse JSON only after verifying.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })

  app.post('/webhooks/bitbucket', async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!deps.bitbucket.verifyWebhook(raw, req.headers)) {
      return reply.code(401).send({ error: 'Bad signature' })
    }
    const event = String(req.headers['x-event-key'] ?? '')
    const delivery = String(req.headers['x-request-uuid'] ?? '')
    if (!delivery) return reply.code(400).send({ error: 'Missing request id' })
    if (!(await claimDelivery(deps.db, `bitbucket:${delivery}`)))
      return { ok: true, duplicate: true }

    let payload: Payload
    try {
      payload = record(JSON.parse(raw.toString('utf8')))
    } catch {
      return reply.code(400).send({ error: 'Not JSON' })
    }
    try {
      if (event === 'pullrequest:created' || event === 'pullrequest:updated') {
        await onPullRequest(deps, payload)
      } else if (event === 'pullrequest:comment_created') {
        await onComment(deps, payload)
      }
    } catch (err) {
      // Acknowledge anyway: Bitbucket would only redeliver the same thing.
      deps.logger.error({ err, event, delivery }, 'bitbucket webhook handling failed')
    }
    return { ok: true }
  })
}

const LINK_HELP = (origin: string) =>
  `I couldn't tell who you are in CirCI. Link your Bitbucket account to a CirCI account that belongs to this project's organization (${origin}), then try again.`

/** Where a delivery came from: the workspace and `workspace/repo`. */
function repoOf(p: Payload): { workspace: string; repo: string } | undefined {
  const repository = record(p.repository)
  const repo = str(repository.full_name)
  const workspace = str(record(repository.workspace).slug) ?? repo?.split('/')[0]
  return repo && workspace ? { workspace, repo } : undefined
}

async function onPullRequest(deps: bitbucketWebhookRoutes.Deps, p: Payload) {
  const from = repoOf(p)
  const pr = record(p.pullrequest)
  const number = Number(pr.id)
  if (!from || !Number.isInteger(number)) return
  const author = record(pr.author)
  const login = str(author.nickname) ?? str(author.display_name)
  const authorId = str(author.uuid)
  const source = record(pr.source)
  const commitSha = str(record(source.commit).hash)
  const branch = str(record(source.branch).name)
  const projects = await findBitbucketProjects(deps.db, from.workspace, from.repo)
  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop -- one repository rarely feeds several projects
    await linkBuildsToPullRequest(deps.db, {
      projectId: project.id,
      prNumber: number,
      ...(commitSha ? { commitSha } : {}),
      ...(branch ? { branch } : {}),
    })
    if (login) {
      const members = authorId
        ? // eslint-disable-next-line no-await-in-loop
          await findMembersByAccount(deps.db, project.id, 'bitbucket', authorId)
        : []
      // eslint-disable-next-line no-await-in-loop
      await setPullRequestAuthor(deps.db, {
        projectId: project.id,
        prNumber: number,
        login,
        userId: members.length === 1 ? (members[0] ?? null) : null,
      })
    }
  }
}

async function onComment(deps: bitbucketWebhookRoutes.Deps, p: Payload) {
  const comment = record(p.comment)
  const command = parseCommand(str(record(comment.content).raw) ?? '')
  if (!command) return
  const from = repoOf(p)
  const pr = Number(record(p.pullrequest).id)
  const actorId = str(record(comment.user).uuid) ?? ''
  if (!from || !Number.isInteger(pr)) return

  const projects = await findBitbucketProjects(deps.db, from.workspace, from.repo)
  let acted = false
  let refused = false
  let credentials: string | undefined
  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop -- one repository rarely feeds several projects
    const builds = await latestBuildsForPr(deps.db, project.id, pr)
    if (builds.length === 0) continue
    credentials ??= openConnectionCredentials(deps.authSecret, project.encryptedCredentials)
    const members = actorId
      ? // eslint-disable-next-line no-await-in-loop
        await findMembersByAccount(deps.db, project.id, 'bitbucket', actorId)
      : []
    const userId = members.length === 1 ? members[0] : undefined
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
            source: 'bitbucket-comment',
          })
        } else {
          continue
        }
        acted = true
      } catch (err) {
        deps.logger.info({ err, buildId: build.id, command }, 'bitbucket command not applicable')
      }
    }
  }
  // Bitbucket has no reactions: answer with a reply.
  if (!deps.bitbucket.reply || !credentials) return
  const text = acted
    ? `Done: ${command === 'rerun' ? 'rerunning' : command === 'approve' ? 'approved' : 'rejected'} the latest CirCI build${command === 'rerun' ? 's' : ''}.`
    : refused
      ? LINK_HELP(deps.publicOrigin)
      : `Nothing to ${command} on this pull request.`
  await deps.bitbucket.reply(from.workspace, from.repo, pr, text, credentials)
}
