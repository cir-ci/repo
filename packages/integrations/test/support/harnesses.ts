import { ProviderApiError, SlackApiError, FigmaApiError } from '@circi/providers'

import type { IntegrationDefinition } from '#src/index.ts'

import type { DefinitionHarness } from './contract.ts'
import { fakeBitbucket, fakeFigma, fakeGitlab, fakeSlack, fakeTrackers } from './fakes.ts'

const base = {
  authSecret: 'a-long-instance-secret-for-tests-0123456789',
  publicOrigin: 'https://ci.acme.io',
  config: {},
} satisfies IntegrationDefinition.Context

const hostWith = (listRepositories: () => Promise<unknown>): IntegrationDefinition.Context => ({
  ...base,
  gitProviders: { github: { listRepositories } },
})

const revoked401 = new ProviderApiError(401, 'Unauthorized', { revoked: true })

/** One harness per registered definition id; a definition without one fails `harnesses.test.ts`. */
export const harnesses: Record<string, () => DefinitionHarness> = {
  github() {
    return {
      ctx: hostWith(async () => []),
      connect: {
        good: { installationId: '501' },
        bad: {
          input: { installationId: '9' },
          ctx: hostWith(async () => {
            throw new ProviderApiError(404, 'Not Found', { revoked: true })
          }),
        },
      },
      revoked: revoked401,
      secrets: [],
    }
  },

  gitlab: () => ({
    ctx: { ...base, fetch: fakeGitlab('glpat-good') },
    connect: {
      good: { baseUrl: 'https://gitlab.test', token: 'glpat-good' },
      bad: { input: { baseUrl: 'https://gitlab.test', token: 'glpat-wrong' } },
    },
    revoked: revoked401,
    secrets: ['glpat-good'],
  }),

  bitbucket: () => ({
    ctx: { ...base, fetch: fakeBitbucket('bb-good') },
    connect: {
      good: { bitbucketWorkspace: 'acme', token: 'bb-good' },
      bad: { input: { bitbucketWorkspace: 'acme', token: 'bb-wrong' } },
    },
    revoked: revoked401,
    secrets: ['bb-good'],
  }),

  slack() {
    const { ctx } = fakeSlack()
    return {
      ctx,
      oauth: { goodCode: 'good', badCode: 'bad' },
      revoked: new SlackApiError('invalid_auth', 200),
      chat: { ref: 'C1', credentials: 'xoxb-1' },
      secrets: ['cs', 'xoxb-1'],
    }
  },

  linear() {
    const { ctx } = fakeTrackers()
    return {
      ctx,
      connect: { good: { apiKey: 'lin_good' }, bad: { input: { apiKey: 'lin_nope' } } },
      revoked: revoked401,
      secrets: ['lin_good'],
    }
  },

  jira() {
    const { ctx } = fakeTrackers()
    const form = { siteUrl: 'acme.atlassian.net', email: 'me@acme.test' }
    return {
      ctx,
      connect: {
        good: { ...form, apiToken: 'jira-good' },
        bad: { input: { ...form, apiToken: 'jira-nope' } },
      },
      revoked: revoked401,
      secrets: ['jira-good'],
    }
  },

  figma() {
    const { ctx } = fakeFigma()
    return {
      ctx,
      connect: { good: { token: 'figd_good' }, bad: { input: { token: 'figd_wrong' } } },
      revoked: new FigmaApiError(403, 'Invalid token', { revoked: true }),
      secrets: ['figd_good'],
    }
  },
}
