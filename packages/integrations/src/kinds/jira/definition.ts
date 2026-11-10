import { z } from 'zod'

import { defineIntegration } from '#src/sdk/define.ts'
import type { IntegrationDefinition } from '#src/sdk/definition.ts'
import { InvalidCredentialsError } from '#src/sdk/errors.ts'
import { identifyAccount, trackerAttention, trackerTargets } from '#src/tracker/support.ts'
import { createTrackerFactory, serializeCredentials } from '#src/tracker/tracker.ts'

import { JiraTracker, normalizeJiraSite } from './client.ts'

/**
 * Jira Cloud: connected with the site's address, an account email and an API token; a team's
 * issues go to one Jira project (by key). The adapter (`JiraTracker`) is in `client.ts` beside it.
 * The stored credentials are the JSON `{ kind: 'jira', siteUrl, email, apiToken }`.
 */

const trackerOf = (credentials: string, ctx: IntegrationDefinition.Context) =>
  createTrackerFactory(ctx.fetch ? { fetch: ctx.fetch } : {})('jira', credentials)

export const jira = defineIntegration({
  id: 'jira',
  group: 'tracker',
  name: 'Jira',
  description: 'Create an issue from a rejected screenshot, with the diff attached.',
  logo: 'jira',
  exclusive: { team: 'kind' },
  credentials: z.object({
    siteUrl: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .meta({ label: 'Site address', placeholder: 'acme.atlassian.net' }),
    email: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .meta({ label: 'Account email', placeholder: 'you@acme.com' }),
    apiToken: z.string().trim().min(1).max(1000).meta({
      label: 'API token',
      secret: true,
      description: 'From id.atlassian.com, Security, API tokens.',
    }),
  }),

  async connect(input, ctx) {
    // Only an https address of a named host: an IP or `localhost` could aim the server at its own network.
    const siteUrl = normalizeJiraSite(input.siteUrl)
    if (!siteUrl) {
      throw new InvalidCredentialsError('siteUrl: use the https address of your Jira Cloud site')
    }
    const tracker = new JiraTracker({
      siteUrl,
      email: input.email,
      apiToken: input.apiToken,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    })
    const account = await identifyAccount('Jira', tracker)
    return {
      externalId: account.externalId,
      displayName: account.name,
      credentials: serializeCredentials({
        kind: 'jira',
        siteUrl,
        email: input.email,
        apiToken: input.apiToken,
      }),
    }
  },

  needsAttention: (err) => trackerAttention('Jira', err),

  events: [],

  capabilities: { tracker: { create: trackerOf } },

  mapping: {
    description:
      'Choose the Jira project each CirCI team files issues in. A team without one has no “Create issue”.',
    target: { label: 'Project', kind: 'select' },
    listTargets: (credentials, ctx) => trackerTargets(trackerOf(credentials, ctx)),
    fields: [
      {
        kind: 'text',
        key: 'issueType',
        label: 'Issue type',
        // Left empty, the issue is a Task; the name must exist in the Jira project.
        placeholder: 'Task',
        optional: true,
      },
    ],
  },
})
