import {
  fakeBitbucketHost,
  fakeFigmaFileHost,
  fakeGitlabHost,
  fakeSlackWorkspaceHost,
  fakeTrackersHost,
} from '@circi/testing/hosts'

import type { IntegrationDefinition } from '#src/index.ts'

/** The integration context the definitions run with, its `fetch` pointing at a fake host. */
const contextFor = (
  fetch: typeof globalThis.fetch,
  config: IntegrationDefinition.Context['config'] = {},
): IntegrationDefinition.Context => ({
  authSecret: 'a-long-instance-secret-for-tests-0123456789',
  publicOrigin: 'https://ci.acme.io',
  config,
  fetch,
})

export function fakeTrackers(options: { down?: boolean } = {}) {
  const host = fakeTrackersHost(options)
  return { calls: host.calls, ctx: contextFor(host.fetcher) }
}

export function fakeSlack() {
  const host = fakeSlackWorkspaceHost()
  return {
    posts: host.posts,
    ctx: contextFor(host.fetcher, {
      slack: { clientId: 'cid', clientSecret: 'cs', apiUrl: 'https://slack.test/api' },
    }),
  }
}

export function fakeFigma(options: { down?: boolean } = {}) {
  const host = fakeFigmaFileHost(options)
  return { ctx: contextFor(host.fetcher), comments: host.comments }
}

/** GitLab's REST edge for `connect`: the user and the project list, 401 for any other token. */
export const fakeGitlab = (token: string): typeof fetch =>
  fakeGitlabHost({ token, projects: [] }).fetcher

/** Bitbucket Cloud's edge for `connect`: the repository list, 401 for any other bearer token. */
export const fakeBitbucket = (token: string): typeof fetch =>
  fakeBitbucketHost({ workspace: 'acme', repos: [], token }).fetcher
