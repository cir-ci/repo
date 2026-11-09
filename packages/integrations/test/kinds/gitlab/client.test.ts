import { fakeGitlabHost } from '@circi/testing/hosts'
import { describe, expect, it } from 'vitest'

import { type GitProvider, isConnectionRevoked, ProviderApiError } from '#src/git/provider.ts'
import { type CheckReport } from '#src/git/render.ts'
import {
  GitlabProvider,
  gitlabCredentials,
  gitlabExternalId,
  gitlabWebhookVerifier,
  normalizeGitlabBaseUrl,
  verifyGitlabToken,
} from '#src/kinds/gitlab/client.ts'
import {
  type ProviderHarness,
  runGitProviderContract,
} from '#test/support/git-provider-contract.ts'

const BASE = 'https://gitlab.test'
const creds = gitlabCredentials(BASE, 'glpat-fake')

/** The contract calls adapters without credentials: the notify job would pass these. */
function withCredentials(p: GitlabProvider, credentials: string): GitProvider {
  return {
    kind: p.kind,
    upsertCheckRun: (e, r, i) => p.upsertCheckRun(e, r, i, credentials),
    upsertComment: (e, r, n, b, id) => p.upsertComment(e, r, n, b, id, credentials),
    verifyWebhook: (b, h) => p.verifyWebhook(b, h),
    listRepositories: (e) => p.listRepositories(e, credentials),
  }
}

const projects = [
  { path: 'acme/web', visibility: 'private' as const },
  { path: 'acme/tools/oss', visibility: 'public' as const },
]

function harness(): ProviderHarness {
  const fake = fakeGitlabHost({ token: 'glpat-fake', projects })
  return {
    provider: withCredentials(
      new GitlabProvider({ webhookSecret: 's3cret', fetch: fake.fetcher }),
      creds,
    ),
    externalId: 'gitlab.test#7',
    repo: 'acme/web',
    prNumber: 7,
    repositories: projects.map((p) => p.path),
    host: fake.host,
    signed: () => ({ 'x-gitlab-token': 's3cret' }),
    tokenOnly: true,
  }
}

runGitProviderContract('GitLab', harness)

const report = (over: Partial<CheckReport>): CheckReport => ({
  name: 'CirCI / default',
  status: 'completed',
  title: 't',
  summary: 's',
  actions: [],
  ...over,
})

const make = () => {
  const fake = fakeGitlabHost({ token: 'glpat-fake', projects })
  return {
    fake,
    gitlab: new GitlabProvider({
      webhookSecret: 's3cret',
      fetch: fake.fetcher,
    }),
  }
}
const input = (r: CheckReport) => ({
  sha: 'abc',
  report: r,
  detailsUrl: 'https://ci/x',
})

describe('GitLab adapter', () => {
  it('maps the report to GitLab commit states and URL-encodes the project path', async () => {
    const { fake, gitlab } = make()
    const states: [Partial<CheckReport>, string][] = [
      [{ status: 'in_progress' }, 'running'],
      [{ conclusion: 'success' }, 'success'],
      [{ conclusion: 'neutral' }, 'success'],
      [{ conclusion: 'failure' }, 'failed'],
      [{ conclusion: 'action_required' }, 'failed'],
    ]
    for (const [over, state] of states) {
      // eslint-disable-next-line no-await-in-loop -- sequential on one fake
      await gitlab.upsertCheckRun('x', 'acme/tools/oss', input(report(over)), creds)
      expect(fake.host.stateOf('CirCI / default')).toBe(state)
    }
    expect(fake.host.statusCount()).toBe(1)
    expect(fake.requests.at(-1)?.path).toBe('/projects/acme/tools/oss/statuses/abc')
  })

  it('needs credentials, and says a rejected token is a revoked connection', async () => {
    const { gitlab } = make()
    const missing = await gitlab.listRepositories('x').catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(ProviderApiError)
    expect(isConnectionRevoked(missing)).toBe(false)
    const wrong = await gitlab
      .listRepositories('x', gitlabCredentials(BASE, 'other'))
      .catch((e: unknown) => e)
    expect(isConnectionRevoked(wrong)).toBe(true)
  })

  it('identifies the token principal, replies and reacts', async () => {
    const { fake, gitlab } = make()
    const me = await gitlab.identify(creds)
    expect(me).toEqual({ id: '7', username: 'circi-bot' })
    expect(gitlabExternalId(`${BASE}/sub`, me.id)).toBe('gitlab.test#7')
    await gitlab.reply('acme/web', 3, 'hello', creds)
    expect(fake.host.comments()).toEqual(['hello'])
    await gitlab.react('acme/web', 3, 5, 'thumbsup', creds)
    expect(fake.host.awards()).toEqual(['thumbsup'])
  })

  it('pages through projects', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({
      path: `g/p${i}`,
      visibility: 'public' as const,
    }))
    const fake = fakeGitlabHost({ token: 'glpat-fake', projects: many })
    const gitlab = new GitlabProvider({ fetch: fake.fetcher })
    expect(await gitlab.listRepositories('x', creds)).toHaveLength(130)
  })
})

describe('GitLab webhook token', () => {
  it('accepts only the configured token', () => {
    expect(verifyGitlabToken('s3cret', 's3cret')).toBe(true)
    expect(verifyGitlabToken('s3cret', 's3cre')).toBe(false)
    expect(verifyGitlabToken('s3cret', 's3cretX')).toBe(false)
    expect(verifyGitlabToken('s3cret', '')).toBe(false)
    expect(verifyGitlabToken('s3cret', undefined)).toBe(false)
    expect(verifyGitlabToken('', '')).toBe(false)
  })

  it('compares in constant time: the digests, never the raw strings', () => {
    // Equal-length digests make timingSafeEqual safe for any input length (it throws otherwise).
    expect(() => verifyGitlabToken('a', 'a-much-longer-token-than-the-secret')).not.toThrow()
  })

  it('verifies through the header as a single or repeated header, and without a secret refuses all', () => {
    const v = gitlabWebhookVerifier('s3cret')
    expect(v.verifyWebhook('{}', { 'x-gitlab-token': 's3cret' })).toBe(true)
    expect(v.verifyWebhook('{}', { 'x-gitlab-token': ['s3cret'] })).toBe(true)
    expect(v.verifyWebhook('{}', { 'x-gitlab-token': 'bad' })).toBe(false)
    expect(new GitlabProvider().verifyWebhook('{}', { 'x-gitlab-token': 's3cret' })).toBe(false)
  })

  it('normalizes base URLs', () => {
    expect(normalizeGitlabBaseUrl(' https://gitlab.com/ ')).toBe('https://gitlab.com')
    expect(normalizeGitlabBaseUrl('https://h.test/gitlab/')).toBe('https://h.test/gitlab')
    expect(normalizeGitlabBaseUrl('ftp://h')).toBeUndefined()
    expect(normalizeGitlabBaseUrl('nope')).toBeUndefined()
  })
})
