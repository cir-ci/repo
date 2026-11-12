import { asRecord } from '@circi/core'
import { z } from 'zod'

import { headerValue } from '#src/git/provider.ts'
import { ignoredReply, parseCommand } from '#src/git/render.ts'
import {
  connectFailure,
  derivedWebhookSecret,
  revokedAttention,
  str,
  stubbed,
} from '#src/git/support.ts'
import { defineIntegration } from '#src/sdk/define.ts'
import type { IntegrationDefinition } from '#src/sdk/definition.ts'

import { BitbucketCloud, serializeBitbucketCredentials } from './client.ts'

/**
 * Bitbucket Cloud, through a workspace or repository access token (or an app password with its
 * username). A connection is one workspace (its slug is the external id) with the token sealed as
 * JSON; a project maps to one repository (`workspace/repo`). Builds show as a commit status plus one
 * pull request comment. The webhook is signed with a secret derived from the instance secret and
 * shown to owners and admins. A created or updated pull request gives its builds their pull
 * request number (matched by commit or source branch).
 */

const providerOf = (ctx: IntegrationDefinition.Context): BitbucketCloud =>
  stubbed<BitbucketCloud>(ctx, 'bitbucket') ??
  new BitbucketCloud({
    webhookSecret: derivedWebhookSecret(ctx.authSecret, 'bitbucket'),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  })

const WORKSPACE_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/
const REPO_RE = /^[a-z0-9][\w-]*\/[\w.-]+$/i

const REVOKED =
  'Bitbucket no longer accepts the token (revoked or without access). Connect it again with a new token.'

const LINK_HELP = (origin: string) =>
  `I couldn't tell who you are in CirCI. Link your Bitbucket account to a CirCI account that belongs to this project's workspace (${origin}), then try again.`

/** Where a delivery came from: the workspace and `workspace/repo`. */
function repoOf(p: Record<string, unknown>): IntegrationDefinition.GitRepo | undefined {
  const repository = asRecord(p.repository)
  const ref = str(repository.full_name)
  const workspace = str(asRecord(repository.workspace).slug) ?? ref?.split('/')[0]
  return ref && workspace ? { ref, connection: { externalId: workspace } } : undefined
}

function events(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  p: Record<string, unknown>,
): IntegrationDefinition.GitEvent[] {
  const event = headerValue(headers, 'x-event-key')
  const repo = repoOf(p)
  const pr = asRecord(p.pullrequest)
  const number = Number(pr.id)
  if (!repo || !Number.isInteger(number)) return []
  if (event === 'pullrequest:created' || event === 'pullrequest:updated') {
    const author = asRecord(pr.author)
    const login = str(author.nickname) ?? str(author.display_name)
    const accountId = str(author.uuid)
    const source = asRecord(pr.source)
    const sha = str(asRecord(source.commit).hash)
    const branch = str(asRecord(source.branch).name)
    return [
      {
        type: 'pull_request',
        repo,
        number,
        author: login ? { login, ...(accountId ? { accountId } : {}) } : null,
        head: { ...(sha ? { sha } : {}), ...(branch ? { branch } : {}) },
      },
    ]
  }
  if (event === 'pullrequest:comment_created') {
    const comment = asRecord(p.comment)
    const command = parseCommand(str(asRecord(comment.content).raw) ?? '')
    if (!command) return []
    const user = asRecord(comment.user)
    return [
      {
        type: 'command',
        repo,
        number,
        command,
        actor: { accountId: str(user.uuid) ?? '', login: str(user.nickname) ?? '' },
      },
    ]
  }
  return []
}

export const bitbucket = defineIntegration({
  id: 'bitbucket',
  group: 'git',
  name: 'Bitbucket',
  description: 'Build status on the pull request, one summary comment, and /circi commands.',
  logo: 'bitbucket',
  exclusive: { account: true, project: 'group' },
  replaceOnReconnect: true,
  credentials: z.strictObject({
    bitbucketWorkspace: z
      .string()
      .trim()
      .toLowerCase()
      .regex(WORKSPACE_RE, 'Use the workspace ID, e.g. acme (as in bitbucket.org/acme)')
      .meta({
        label: 'Bitbucket workspace',
        description: 'The workspace ID: acme in bitbucket.org/acme.',
        placeholder: 'acme',
      }),
    token: z.string().trim().min(1, 'Enter an access token').max(4096).meta({
      label: 'Access token',
      secret: true,
      description: 'A workspace or repository access token that can read and write pull requests.',
    }),
    username: z.string().trim().min(1).max(200).optional().meta({
      label: 'Username',
      description: 'Only for an app password: the Bitbucket username it belongs to.',
    }),
  }),

  async connect(input, ctx) {
    const credentials = serializeBitbucketCredentials({
      token: input.token,
      ...(input.username ? { username: input.username } : {}),
    })
    try {
      await providerOf(ctx).listRepositories(input.bitbucketWorkspace, credentials)
    } catch (err) {
      throw connectFailure('Bitbucket', err, {
        revoked: "Bitbucket didn't accept that token",
        forbidden: "That token cannot read the workspace's repositories",
        notFound: 'Bitbucket has no workspace with that id',
      })
    }
    return {
      externalId: input.bitbucketWorkspace,
      displayName: input.bitbucketWorkspace,
      credentials,
    }
  },

  needsAttention: revokedAttention(REVOKED),

  events: [],

  capabilities: {
    git: {
      provider: providerOf,
      webhook: {
        deliveryId(headers) {
          const id = headerValue(headers, 'x-request-uuid')
          return id ? `bitbucket:${id}` : null
        },
        events,
        secret: (ctx) => derivedWebhookSecret(ctx.authSecret, 'bitbucket'),
      },
      async respond(input, ctx) {
        const { event, connection } = input
        if (event.type !== 'command' || !connection.credentials) return
        // Bitbucket has no reactions: answer with a reply.
        const text =
          input.outcome === 'acted'
            ? `Done: ${event.command === 'rerun' ? 'rerunning' : event.command === 'approve' ? 'approved' : 'rejected'} the latest CirCI build${event.command === 'rerun' ? 's' : ''}.`
            : input.outcome === 'refused'
              ? LINK_HELP(ctx.publicOrigin)
              : ignoredReply(event.command, input.reason)
        await providerOf(ctx).reply(
          connection.externalId,
          event.repo.ref,
          event.number,
          text,
          connection.credentials,
        )
      },
    },
  },

  mapping: {
    description:
      'Choose the repository each project reports to. Builds show up on the pull request as a commit status and one summary comment.',
    target: {
      label: 'Repository',
      kind: 'repository',
      placeholder: 'acme/web',
      validate: (ref) => (REPO_RE.test(ref) ? null : 'Use workspace/repository, e.g. acme/web'),
    },
  },
})
