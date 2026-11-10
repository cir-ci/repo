import { asRecord, INSTALLATION_ID_RE } from '@circi/core'
import { z } from 'zod'

import { headerValue } from '#src/git/provider.ts'
import { parseCommand } from '#src/git/render.ts'
import { connectFailure, revokedAttention, str, stubbed } from '#src/git/support.ts'
import { defineIntegration } from '#src/sdk/define.ts'
import type { IntegrationDefinition } from '#src/sdk/definition.ts'
import { InvalidInputError } from '#src/sdk/errors.ts'

import { GithubApp } from './client.ts'

/**
 * GitHub, through the instance's GitHub App. A connection is one installation of the App on an
 * account or organisation (its id is the external id); the App's own credentials are instance
 * configuration (`GITHUB_APP_*`), so a connection keeps no secret (`secretless`). A team maps
 * to one repository of the installation. Builds show as a check run with Approve and Reject
 * buttons plus one summary comment; the App's webhook (`/webhooks/github`) brings pull requests,
 * `/circi` commands and the buttons.
 *
 * Connecting names an installation id, so it is checked with GitHub (a token is minted and the
 * repositories listed: the App must really be installed there, which also keeps one workspace
 * from claiming another's installation), and no other workspace of the instance may use it.
 */

const apps = new WeakMap<object, GithubApp>()

/** The App for this instance (one per configuration, so its installation tokens are reused). */
function githubApp(ctx: IntegrationDefinition.Context): GithubApp | undefined {
  const stub = stubbed<GithubApp>(ctx, 'github')
  if (stub) return stub
  const config = ctx.config.github
  if (!config) return undefined
  const options = { ...config, ...(ctx.fetch ? { fetch: ctx.fetch } : {}) }
  if (ctx.fetch) return new GithubApp(options)
  let app = apps.get(config)
  if (!app) {
    app = new GithubApp(options)
    apps.set(config, app)
  }
  return app
}

const REVOKED =
  'The GitHub App was removed or suspended. Reinstall or unsuspend it on GitHub, then save a repository again.'

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

const LINK_HELP = (origin: string) =>
  `I couldn't tell who you are in CirCI. Sign in at ${origin} with GitHub (Account and sessions → link GitHub) using a member of this team's workspace, then try again.`

const repoOf = (p: Record<string, unknown>): IntegrationDefinition.GitRepo | undefined => {
  const installation = str(asRecord(p.installation).id)
  const ref = str(asRecord(p.repository).full_name)
  return installation && ref ? { ref, connection: { externalId: installation } } : undefined
}

function events(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  p: Record<string, unknown>,
): IntegrationDefinition.GitEvent[] {
  const event = headerValue(headers, 'x-github-event')
  if (event === 'check_run') {
    if (p.action !== 'requested_action') return []
    const identifier = str(asRecord(p.requested_action).identifier)
    const checkRunId = str(asRecord(p.check_run).id)
    if ((identifier !== 'approve' && identifier !== 'reject') || !checkRunId) return []
    const sender = asRecord(p.sender)
    const repo = repoOf(p)
    return [
      {
        type: 'check_action',
        action: identifier,
        checkRunId,
        ...(repo ? { repo } : {}),
        actor: { accountId: str(sender.id) ?? '', login: str(sender.login) ?? '' },
      },
    ]
  }
  if (event === 'pull_request') {
    if (p.action !== 'opened' && p.action !== 'reopened' && p.action !== 'synchronize') return []
    const pr = asRecord(p.pull_request)
    const author = asRecord(pr.user)
    const login = str(author.login)
    const number = Number(pr.number)
    const repo = repoOf(p)
    if (!login || !Number.isInteger(number) || !repo) return []
    const accountId = str(author.id)
    return [
      {
        type: 'pull_request',
        repo,
        number,
        author: { login, ...(accountId ? { accountId } : {}) },
      },
    ]
  }
  if (event === 'issue_comment') {
    if (p.action !== 'created') return []
    const issue = asRecord(p.issue)
    if (!issue.pull_request) return []
    const comment = asRecord(p.comment)
    const user = asRecord(comment.user)
    if (str(user.type) === 'Bot') return []
    const command = parseCommand(str(comment.body) ?? '')
    const repo = repoOf(p)
    const number = Number(issue.number)
    const commentId = str(comment.id)
    if (!command || !repo || !Number.isInteger(number) || !commentId) return []
    return [
      {
        type: 'command',
        repo,
        number,
        command,
        commentId,
        actor: { accountId: str(user.id) ?? '', login: str(user.login) ?? '' },
      },
    ]
  }
  return []
}

export const github = defineIntegration({
  id: 'github',
  group: 'git',
  name: 'GitHub',
  description: 'Build status on the pull request, one summary comment, and sign-in with GitHub.',
  logo: 'github',
  secretless: true,
  replaceOnReconnect: true,
  exclusive: { account: true, team: 'group' },
  credentials: z.strictObject({
    installationId: z
      .string()
      .trim()
      .regex(INSTALLATION_ID_RE, 'The installation ID is a number')
      .meta({
        label: 'GitHub App installation ID',
        description:
          "Install the CirCI GitHub App on your account or organisation, then paste the number at the end of the installation's settings address on GitHub.",
        placeholder: '12345678',
      }),
  }),

  available: (ctx) => githubApp(ctx) !== undefined,

  // GitHub's `setup_url` return: `?installation_id=…&setup_action=install|update`.
  setup: (query) => (query.installation_id ? { installationId: query.installation_id } : undefined),

  async connect(input, ctx) {
    const app = githubApp(ctx)
    if (!app) throw new InvalidInputError('This instance has no GitHub App configured')
    try {
      await app.listRepositories(input.installationId)
    } catch (err) {
      throw connectFailure('GitHub', err, {
        revoked: "The GitHub App isn't installed with that installation ID",
        revokedIsNotFound: true,
      })
    }
    return {
      externalId: input.installationId,
      displayName: `Installation ${input.installationId}`,
      credentials: '',
    }
  },

  needsAttention: revokedAttention(REVOKED),

  events: [],

  capabilities: {
    git: {
      provider: (ctx) => githubApp(ctx),
      webhook: {
        deliveryId: (headers) => headerValue(headers, 'x-github-delivery') ?? null,
        events,
      },
      async respond(input, ctx) {
        const app = githubApp(ctx)
        const { event, connection } = input
        const repo = event.repo?.ref
        if (!app || !repo) return
        if (event.type === 'check_action') {
          const pr = input.prNumber
          if (input.outcome === 'refused' && pr !== undefined) {
            await app.reply(connection.externalId, repo, pr, LINK_HELP(ctx.publicOrigin))
          }
          return
        }
        if (!event.commentId) return
        if (input.outcome === 'acted') {
          await app.react(connection.externalId, repo, event.commentId, '+1')
        } else if (input.outcome === 'refused') {
          await app.reply(connection.externalId, repo, event.number, LINK_HELP(ctx.publicOrigin))
        } else {
          await app.react(connection.externalId, repo, event.commentId, '-1')
        }
      },
    },
  },

  mapping: {
    description:
      'Choose the repository each team reports to. Builds show up on the pull request as a check with Approve and Reject buttons, and as one summary comment.',
    target: {
      label: 'Repository',
      kind: 'repository',
      placeholder: 'acme/web',
      validate: (ref) => (REPO_RE.test(ref) ? null : 'Use owner/name, e.g. acme/web'),
    },
  },
})
