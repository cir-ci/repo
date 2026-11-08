import { createTrackerFactory, LinearTracker, serializeCredentials } from '@circi/providers'
import { z } from 'zod'

import { defineIntegration } from './define.ts'
import type { IntegrationDefinition } from './definition.ts'
import { identifyAccount, trackerAttention, trackerTargets } from './tracker-support.ts'

/**
 * Linear: connected with an API key; a project's issues go to one team. The adapter
 * (`LinearTracker`) is in `@circi/providers`; this file wires it to the SDK. The stored
 * credentials are the JSON `{ kind: 'linear', apiKey }`.
 */

const trackerOf = (credentials: string, ctx: IntegrationDefinition.Context) =>
  createTrackerFactory(ctx.fetch ? { fetch: ctx.fetch } : {})('linear', credentials)

export const linear = defineIntegration({
  id: 'linear',
  group: 'tracker',
  name: 'Linear',
  description: 'Create an issue from a rejected snapshot, with the diff attached.',
  logo: 'linear',
  pageStyle: 'generic',
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
      'Choose the team each project files issues in. A project without a team has no “Create issue”.',
    target: { label: 'Team', kind: 'select' },
    listTargets: (credentials, ctx) => trackerTargets(trackerOf(credentials, ctx)),
  },
})
