import {
  claimDelivery,
  type Database,
  findBuildByCheckRun,
  findMemberByGithubId,
  findProjectsByRepo,
  latestBuildsForPr,
} from '@circi/db'
import {
  type GitProvider,
  type GithubApp,
  githubWebhookVerifier,
  parseCommand,
  type ProviderRegistry,
  providerRegistry,
} from '@circi/providers'
import { recordPullRequestAuthor, requeueBuild, reviewBuild } from '@circi/services'
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'

/**
 * `POST /webhooks/github`: what GitHub tells the CirCI GitHub App (PLAN §7.4). Two things
 * matter: someone pressed Approve/Reject on a check run, or commented `/circi approve|reject|
 * rerun` on a pull request. Everything else is acknowledged and ignored.
 *
 * Deliveries are verified by signature, handled once per delivery id, and only act for GitHub
 * users who linked their GitHub login to a CirCI account that belongs to the project's
 * organization.
 */

export namespace githubWebhookRoutes {
  export interface Deps {
    db: Database
    secret: string
    /** Used to answer on pull requests; the handler still works (silently) without it. */
    github: Pick<GithubApp, 'react' | 'reply'> | undefined
    /** Adapters by connection kind; the delivery is verified by the `github` one. Defaults to one built from `secret`. */
    providers?: ProviderRegistry<Pick<GitProvider, 'verifyWebhook'>>
    publicOrigin: string
    logger: FastifyBaseLogger
  }
}

interface Actor {
  id: string
  login: string
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined

export const githubWebhookRoutes: FastifyPluginAsync<githubWebhookRoutes.Deps> = async (
  app,
  deps,
) => {
  // The signature covers the exact bytes, so keep them: parse JSON only after verifying.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })

  const providers =
    deps.providers ?? providerRegistry({ github: githubWebhookVerifier(deps.secret) })

  app.post('/webhooks/github', async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!providers.get('github')?.verifyWebhook(raw, req.headers)) {
      return reply.code(401).send({ error: 'Bad signature' })
    }
    const event = String(req.headers['x-github-event'] ?? '')
    const delivery = String(req.headers['x-github-delivery'] ?? '')
    if (!delivery) return reply.code(400).send({ error: 'Missing delivery id' })
    if (!(await claimDelivery(deps.db, delivery))) return { ok: true, duplicate: true }

    let payload: Record<string, unknown>
    try {
      payload = record(JSON.parse(raw.toString('utf8')))
    } catch {
      return reply.code(400).send({ error: 'Not JSON' })
    }
    try {
      if (event === 'check_run') await onCheckRun(deps, payload)
      else if (event === 'issue_comment') await onComment(deps, payload)
      else if (event === 'pull_request') await onPullRequest(deps, payload)
    } catch (err) {
      // Acknowledge anyway: GitHub would only redeliver the same thing.
      deps.logger.error({ err, event, delivery }, 'github webhook handling failed')
    }
    return { ok: true }
  })
}

const LINK_HELP = (origin: string) =>
  `I couldn't tell who you are in CirCI. Sign in at ${origin} with GitHub (Account and sessions → link GitHub) using a member of this project's organization, then try again.`

async function onCheckRun(deps: githubWebhookRoutes.Deps, p: Record<string, unknown>) {
  if (p.action !== 'requested_action') return
  const identifier = str(record(p.requested_action).identifier)
  if (identifier !== 'approve' && identifier !== 'reject') return
  const checkRunId = str(record(p.check_run).id)
  const build = checkRunId ? await findBuildByCheckRun(deps.db, checkRunId) : undefined
  if (!build) return
  const sender = record(p.sender)
  const userId = await findMemberByGithubId(deps.db, str(sender.id) ?? '', build.projectId)
  const installation = str(record(p.installation).id)
  const repo = str(record(p.repository).full_name)
  if (!userId) {
    if (deps.github && installation && repo && build.prNumber !== null) {
      await deps.github.reply(installation, repo, build.prNumber, LINK_HELP(deps.publicOrigin))
    }
    return
  }
  await reviewBuild(deps.db, {
    buildId: build.id,
    userId,
    state: identifier === 'approve' ? 'approved' : 'rejected',
    source: 'github-check',
  })
}

/** The pull request's author replaces the login CI sent on every build of that pull request. */
async function onPullRequest(deps: githubWebhookRoutes.Deps, p: Record<string, unknown>) {
  if (p.action !== 'opened' && p.action !== 'reopened' && p.action !== 'synchronize') return
  const pr = record(p.pull_request)
  const author = record(pr.user)
  const login = str(author.login)
  const number = Number(pr.number)
  const installation = str(record(p.installation).id)
  const repo = str(record(p.repository).full_name)
  if (!login || !Number.isInteger(number) || !installation || !repo) return
  const projects = await findProjectsByRepo(deps.db, installation, repo)
  await Promise.all(
    projects.map((project) =>
      recordPullRequestAuthor(deps.db, {
        projectId: project.id,
        prNumber: number,
        login,
        providerId: str(author.id) ?? null,
      }),
    ),
  )
}

async function onComment(deps: githubWebhookRoutes.Deps, p: Record<string, unknown>) {
  if (p.action !== 'created') return
  const issue = record(p.issue)
  if (!issue.pull_request) return
  const comment = record(p.comment)
  if (str(record(comment.user).type) === 'Bot') return
  const command = parseCommand(str(comment.body) ?? '')
  if (!command) return
  const installation = str(record(p.installation).id)
  const repo = str(record(p.repository).full_name)
  const pr = Number(issue.number)
  const commentId = str(comment.id)
  if (!installation || !repo || !Number.isInteger(pr) || !commentId) return
  const actor: Actor = {
    id: str(record(comment.user).id) ?? '',
    login: str(record(comment.user).login) ?? '',
  }

  const projects = await findProjectsByRepo(deps.db, installation, repo)
  let acted = false
  let refused = false
  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop -- one repository rarely feeds several projects
    const userId = await findMemberByGithubId(deps.db, actor.id, project.id)
    // eslint-disable-next-line no-await-in-loop
    const builds = await latestBuildsForPr(deps.db, project.id, pr)
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
            source: 'github-comment',
          })
        } else {
          continue
        }
        acted = true
      } catch (err) {
        deps.logger.info({ err, buildId: build.id, command }, 'github command not applicable')
      }
    }
  }
  if (!deps.github) return
  if (acted) await deps.github.react(installation, repo, commentId, '+1')
  else if (refused) await deps.github.reply(installation, repo, pr, LINK_HELP(deps.publicOrigin))
  else await deps.github.react(installation, repo, commentId, '-1')
}
