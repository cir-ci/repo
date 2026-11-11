import { z } from 'zod'

import { defineIntegration } from '#src/sdk/define.ts'
import type { IntegrationDefinition } from '#src/sdk/definition.ts'
import { identifyAccount, trackerAttention, trackerTargets } from '#src/tracker/support.ts'
import { createTrackerFactory, serializeCredentials } from '#src/tracker/tracker.ts'

import { LinearTracker } from './client.ts'

/**
 * Linear: connected with an API key; a CirCI project's issues go to one Linear team. The adapter
 * (`LinearTracker`) is in `client.ts` beside it; this file wires it to the SDK. The stored
 * credentials are the JSON `{ kind: 'linear', apiKey }`.
 */

const trackerOf = (credentials: string, ctx: IntegrationDefinition.Context) =>
  createTrackerFactory(ctx.fetch ? { fetch: ctx.fetch } : {})('linear', credentials)

export const linear = defineIntegration({
  id: 'linear',
  group: 'tracker',
  name: 'Linear',
  description: 'Create an issue from a rejected screenshot, with the diff attached.',
  logo: 'linear',
  exclusive: { project: 'kind' },
  credentials: z.object({
    apiKey: z.string().trim().min(1).max(500).meta({
      label: 'API key',
      secret: true,
      description: 'A personal API key from Linear: Settings, Account, Security & access.',
      placeholder: 'lin_api_…',
    }),
  }),

  async connect(input, ctx) {
    const tracker = new LinearTracker({
      apiKey: input.apiKey,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    })
    const account = await identifyAccount('Linear', tracker)
    return {
      externalId: account.externalId,
      displayName: account.name,
      credentials: serializeCredentials({ kind: 'linear', apiKey: input.apiKey }),
    }
  },

  needsAttention: (err) => trackerAttention('Linear', err),

  events: [],

  capabilities: { tracker: { create: trackerOf } },

  mapping: {
    description:
      'Choose the Linear team each CirCI project files issues in. A project without one has no “Create issue”.',
    target: { label: 'Team', kind: 'select' },
    listTargets: (credentials, ctx) => trackerTargets(trackerOf(credentials, ctx)),
  },
})
