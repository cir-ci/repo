import {
  buildApprovedMessage,
  buildRejectedMessage,
  isSlackRevoked,
  reviewOverdueMessage,
  reviewRequestedMessage,
  SlackApiError,
  SlackClient,
  type SlackMessage,
} from '@circi/providers'
import { z } from 'zod'

import { defineIntegration } from './define.ts'
import type { IntegrationDefinition } from './definition.ts'
import { IntegrationUnreachableError, InvalidCredentialsError } from './errors.ts'

/**
 * Slack: install the CirCI Slack app into a workspace (OAuth v2), then each project sends the
 * notices it chooses to one channel. The bot token is the credential (sealed as is). The client
 * and the message builders are in `@circi/providers`; this file only wires them to the SDK.
 */

/** A Slack channel id: public channels start with C, private ones with G. */
const CHANNEL_ID_RE = /^[CG][A-Z0-9]{2,30}$/

const clientOf = (ctx: IntegrationDefinition.Context) =>
  new SlackClient({
    ...(ctx.config.slack?.apiUrl ? { apiUrl: ctx.config.slack.apiUrl } : {}),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  })

function appOf(ctx: IntegrationDefinition.Context) {
  if (!ctx.config.slack)
    throw new InvalidCredentialsError('This instance has no Slack app configured')
  return ctx.config.slack
}

/** The message for an event, or undefined for one Slack does not tell channels about. */
function messageFor(input: IntegrationDefinition.ChatMessage): SlackMessage.Message | undefined {
  const { event, build } = input
  const who = input.reviewer ?? 'Someone'
  const dueAt = event.dueAt ? new Date(event.dueAt) : null
  switch (event.type) {
    case 'review.requested':
      return reviewRequestedMessage({
        build,
        reviewer: who,
        requestedBy: input.actor,
        again: event.again === true,
        dueAt,
      })
    case 'review.overdue':
      return reviewOverdueMessage({ build, reviewer: who, dueAt })
    case 'build.rejected':
      return buildRejectedMessage({ build, reviewer: who, reason: event.reason ?? null })
    case 'build.approved':
      return buildApprovedMessage({ build, reviewer: who })
    default:
      return undefined
  }
}

export const slack = defineIntegration({
  id: 'slack',
  group: 'chat',
  name: 'Slack',
  description: 'Review requested, overdue and rejected notices in a channel per project.',
  logo: 'slack',
  pageStyle: 'generic',
  // Nothing to type: the workspace is connected by installing the app.
  credentials: z.object({}),

  available: (ctx) => ctx.config.slack !== undefined,

  oauth: {
    available: (ctx) => ctx.config.slack !== undefined,
    authorizeUrl: (ctx, input) =>
      clientOf(ctx).authorizeUrl({
        clientId: appOf(ctx).clientId,
        redirectUri: input.redirectUri,
        state: input.state,
      }),
    async exchange(ctx, input) {
      const app = appOf(ctx)
      try {
        const install = await clientOf(ctx).exchangeCode({
          clientId: app.clientId,
          clientSecret: app.clientSecret,
          code: input.code,
          redirectUri: input.redirectUri,
        })
        return {
          externalId: install.teamId,
          displayName: install.teamName,
          credentials: install.botToken,
        }
      } catch (err) {
        if (err instanceof SlackApiError && err.status < 500 && err.status !== 429) {
          throw new InvalidCredentialsError('Slack did not accept the install', { cause: err })
        }
        throw new IntegrationUnreachableError('Slack did not answer; try again shortly', {
          cause: err,
        })
      }
    },
  },

  needsAttention: (err) =>
    isSlackRevoked(err) ? `Slack rejected the token (${err.code}); reinstall the Slack app` : null,

  events: ['review.requested', 'review.overdue', 'build.rejected', 'build.approved'],

  capabilities: {
    chat: {
      async send(input, ctx) {
        const message = messageFor(input)
        if (!message) return
        await clientOf(ctx).postMessage(input.credentials, {
          channel: input.target.ref,
          ...message,
        })
      },
    },
  },

  mapping: {
    description:
      'Choose a channel for each project and which events it hears about. A project without a channel sends nothing.',
    target: {
      label: 'Channel',
      kind: 'select',
      validate: (ref) => (CHANNEL_ID_RE.test(ref) ? null : 'That is not a Slack channel id'),
    },
    async listTargets(credentials, ctx) {
      const channels = await clientOf(ctx).listChannels(credentials)
      return channels.map((c) => ({
        id: c.id,
        name: c.name,
        label: c.private ? `${c.name} (private)` : `#${c.name}`,
      }))
    },
    fields: [
      {
        kind: 'events',
        key: 'events',
        label: 'Events',
        options: [
          { event: 'review.requested', label: 'Review requested' },
          { event: 'review.overdue', label: 'Review overdue' },
          { event: 'build.rejected', label: 'Build rejected' },
          { event: 'build.approved', label: 'Build approved' },
        ],
        // What needs someone to act; approvals are opt-in.
        defaults: ['review.requested', 'review.overdue', 'build.rejected'],
      },
    ],
  },
})
