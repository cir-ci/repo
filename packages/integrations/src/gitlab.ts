import { createHash } from 'node:crypto'

import { asRecord, webhookUrlProblem } from '@circi/core'
import {
  GitlabProvider,
  gitlabCredentials,
  gitlabExternalId,
  headerValue,
  normalizeGitlabBaseUrl,
  parseCommand,
} from '@circi/providers'
import { z } from 'zod'

import { defineIntegration } from './define.ts'
import type { IntegrationDefinition } from './definition.ts'
import { InvalidInputError } from './errors.ts'
import {
  connectFailure,
  derivedWebhookSecret,
  revokedAttention,
  str,
  stubbed,
} from './git-support.ts'

/**
 * GitLab (gitlab.com or self-managed), through an access token with the `api` scope. A connection
 * is the token's principal on one GitLab instance (`<host>#<user id>`, so the same principal cannot
 * belong to two workspaces); its sealed credentials are the address and token as JSON. A
 * team maps to one GitLab project (its path with namespace). Builds show as a commit status
 * with one summary note; commands in notes review from GitLab (statuses have no buttons).
 * GitLab's webhook carries a secret token (`X-Gitlab-Token`), derived from the instance secret and
 * shown to owners and admins.
 */

const providerOf = (ctx: IntegrationDefinition.Context): GitlabProvider =>
  stubbed<GitlabProvider>(ctx, 'gitlab') ??
  new GitlabProvider({
    webhookSecret: derivedWebhookSecret(ctx.authSecret, 'gitlab'),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  })

const REVOKED =
  'GitLab no longer accepts the token (revoked, expired or without access). Connect it again with a new token.'

/** The GitLab project the event is about: its path with namespace, and the host it lives on. */
function repoOf(p: Record<string, unknown>): IntegrationDefinition.GitRepo | undefined {
  const project = asRecord(p.project)
  const ref = str(project.path_with_namespace)
  const webUrl = str(project.web_url)
  if (!ref || !webUrl) return undefined
  try {
    return { ref, connection: { externalIdPrefix: `${new URL(webUrl).host}#` } }
  } catch {
    return undefined
  }
}

const LINK_HELP = (origin: string) =>
  `I couldn't tell who you are in CirCI. Sign in at ${origin} with GitLab (a member of this team's workspace), then try again.`

function events(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  p: Record<string, unknown>,
): IntegrationDefinition.GitEvent[] {
  const event = headerValue(headers, 'x-gitlab-event')
  const repo = repoOf(p)
  if (event === 'Merge Request Hook') {
    const attrs = asRecord(p.object_attributes)
    if (attrs.action !== 'open' && attrs.action !== 'reopen') return []
    const iid = Number(attrs.iid)
    // The user of an open or reopen event is the one who did it; they are the author on open.
    const user = asRecord(p.user)
    const login = str(user.username)
    if (!repo || !login || !Number.isInteger(iid)) return []
    const accountId = str(attrs.author_id) ?? str(user.id)
    return [
      {
        type: 'pull_request',
        repo,
        number: iid,
        author: { login, ...(accountId ? { accountId } : {}) },
      },
    ]
  }
  if (event === 'Note Hook') {
    const attrs = asRecord(p.object_attributes)
    if (attrs.noteable_type !== 'MergeRequest') return []
    // Edits of a note arrive as updates: act on the first mention only.
    if (attrs.action !== undefined && attrs.action !== 'create') return []
    const command = parseCommand(str(attrs.note) ?? '')
    const iid = Number(asRecord(p.merge_request).iid)
    const noteId = str(attrs.id)
    const user = asRecord(p.user)
    const actorId = str(user.id)
    if (!command || !repo || !Number.isInteger(iid) || !noteId || !actorId) return []
    return [
      {
        type: 'command',
        repo,
        number: iid,
        command,
        commentId: noteId,
        actor: { accountId: actorId, login: str(user.username) ?? '' },
      },
    ]
  }
  return []
}

export const gitlab = defineIntegration({
  id: 'gitlab',
  group: 'git',
  name: 'GitLab',
  description: 'Build status on the merge request, one summary note, and sign-in with GitLab.',
  logo: 'gitlab',
  exclusive: { account: true, team: 'group' },
  replaceOnReconnect: true,
  credentials: z.strictObject({
    baseUrl: z.string().trim().min(1, 'Enter the GitLab address').max(512).meta({
      label: 'GitLab address',
      description: 'gitlab.com, or your self-managed instance.',
      placeholder: 'https://gitlab.com',
    }),
    token: z.string().trim().min(1, 'Enter an access token').max(4096).meta({
      label: 'Access token',
      secret: true,
      description: 'A project, group or personal access token with the api scope.',
      placeholder: 'glpat-…',
    }),
  }),

  async connect(input, ctx) {
    const baseUrl = normalizeGitlabBaseUrl(input.baseUrl)
    if (!baseUrl) throw new InvalidInputError('Enter the GitLab address, e.g. https://gitlab.com')
    const problem = webhookUrlProblem(baseUrl, { allowPrivate: ctx.allowPrivateAddresses === true })
    if (problem) throw new InvalidInputError(problem)
    const credentials = gitlabCredentials(baseUrl, input.token)
    const host = providerOf(ctx)
    try {
      const me = await host.identify(credentials)
      await host.listRepositories('', credentials)
      const externalId = gitlabExternalId(baseUrl, me.id)
      return { externalId, displayName: externalId, credentials }
    } catch (err) {
      throw connectFailure('GitLab', err, {
        revoked: 'GitLab did not accept that token',
        forbidden: 'That token cannot read projects: give it the api scope',
        notFound: 'That address does not look like a GitLab server',
      })
    }
  },

  needsAttention: revokedAttention(REVOKED),

  events: [],

  capabilities: {
    git: {
      provider: providerOf,
      webhook: {
        deliveryId(headers, rawBody) {
          // Older GitLab sends no event uuid: the body then identifies the delivery.
          const uuid =
            headerValue(headers, 'x-gitlab-event-uuid') ??
            headerValue(headers, 'idempotency-key') ??
            createHash('sha256').update(rawBody).digest('hex')
          return `gitlab:${uuid}`
        },
        events,
        secret: (ctx) => derivedWebhookSecret(ctx.authSecret, 'gitlab'),
      },
      async respond(input, ctx) {
        const { event, connection } = input
        if (event.type !== 'command' || !connection.credentials || !event.commentId) return
        const host = providerOf(ctx)
        const { credentials } = connection
        if (input.outcome === 'acted') {
          await host.react(event.repo.ref, event.number, event.commentId, 'thumbsup', credentials)
        } else if (input.outcome === 'refused') {
          await host.reply(event.repo.ref, event.number, LINK_HELP(ctx.publicOrigin), credentials)
        } else {
          await host.react(event.repo.ref, event.number, event.commentId, 'thumbsdown', credentials)
        }
      },
    },
  },

  mapping: {
    description:
      'Choose the GitLab project each CirCI team reports to. Builds show up on the merge request as a commit status and one summary note; /circi approve, reject or rerun in a note acts on its latest builds.',
    target: {
      label: 'GitLab project',
      kind: 'repository',
      placeholder: 'acme/web',
      validate: (ref) =>
        /^[\w.-]+(\/[\w.-]+)+$/.test(ref)
          ? null
          : 'Use the project path with its namespace, e.g. acme/web',
    },
  },
})
