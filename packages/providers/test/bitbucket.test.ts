import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  BitbucketCloud,
  bitbucketStatusKey,
  bitbucketWebhookVerifier,
  type CheckReport,
  isConnectionRevoked,
  ProviderApiError,
  serializeBitbucketCredentials,
  verifyBitbucketSignature,
} from '#src/index.ts'

import { type ProviderHarness, runGitProviderContract } from './support/contract.ts'
import { fakeBitbucketHost } from './support/fake-bitbucket-host.ts'

const API = 'https://api.bitbucket.test/2.0'
const TOKEN = 'bb-token'
const credentials = serializeBitbucketCredentials({ token: TOKEN })

function bitbucketHarness(): ProviderHarness {
  const repos = ['acme/web', 'acme/api-private']
  const fake = fakeBitbucketHost({ workspace: 'acme', repos, token: TOKEN })
  const real = new BitbucketCloud({
    apiUrl: API,
    webhookSecret: 's3cret',
    fetch: fake.fetcher,
  })
  return {
    // The contract calls without credentials; a Bitbucket connection always has them.
    provider: {
      kind: real.kind,
      upsertCheckRun: (e, r, i) => real.upsertCheckRun(e, r, i, credentials),
      upsertComment: (e, r, n, b, id) => real.upsertComment(e, r, n, b, id, credentials),
      listRepositories: (e) => real.listRepositories(e, credentials),
      verifyWebhook: (b, h) => real.verifyWebhook(b, h),
    },
    externalId: 'acme',
    repo: 'acme/web',
    prNumber: 7,
    repositories: repos,
    host: fake.host,
    signed: (body) => fake.sign('s3cret', body),
  }
}

runGitProviderContract('Bitbucket', bitbucketHarness)

const report = (over: Partial<CheckReport> = {}): CheckReport => ({
  name: 'CirCI / default',
  status: 'completed',
  conclusion: 'success',
  title: 'No visual changes',
  summary: 's',
  actions: [],
  ...over,
})

const answer = (status: number): BitbucketCloud =>
  new BitbucketCloud({
    apiUrl: API,
    fetch: async () => Response.json({ error: { message: 'nope' } }, { status }),
  })

describe('Bitbucket adapter', () => {
  it('posts the build state on the commit under a stable key', async () => {
    const fake = fakeBitbucketHost({
      workspace: 'acme',
      repos: [],
      token: TOKEN,
    })
    const bodies: unknown[] = []
    const bb = new BitbucketCloud({
      apiUrl: API,
      fetch: async (input, init) => {
        bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'))
        return fake.fetcher(input, init)
      },
    })
    const states: [CheckReport, string][] = [
      [report({ status: 'in_progress' }), 'INPROGRESS'],
      [report(), 'SUCCESSFUL'],
      [report({ conclusion: 'neutral' }), 'SUCCESSFUL'],
      [report({ conclusion: 'action_required' }), 'FAILED'],
      [report({ conclusion: 'failure' }), 'FAILED'],
    ]
    for (const [r, state] of states) {
      // eslint-disable-next-line no-await-in-loop -- in order
      const id = await bb.upsertCheckRun(
        'acme',
        'acme/web',
        { sha: 'abc', report: r, detailsUrl: 'https://ci/b/1' },
        credentials,
      )
      expect(id).toBe(bitbucketStatusKey('CirCI / default'))
      expect(bodies.at(-1)).toMatchObject({
        key: id,
        state,
        name: 'CirCI / default',
        url: 'https://ci/b/1',
      })
    }
    expect(fake.host.statusCount()).toBe(1)
    expect(bitbucketStatusKey('CirCI / default').length).toBeLessThanOrEqual(40)
    expect(bitbucketStatusKey('CirCI / other')).not.toBe(bitbucketStatusKey('CirCI / default'))
  })

  it('sends a bearer token, or basic authentication for an app password', async () => {
    const seen: (string | null)[] = []
    const bb = new BitbucketCloud({
      apiUrl: API,
      fetch: async (_i, init) => {
        seen.push(new Headers(init?.headers).get('authorization'))
        return Response.json({ values: [] })
      },
    })
    await bb.listRepositories('acme', credentials)
    await bb.listRepositories(
      'acme',
      serializeBitbucketCredentials({ token: 'pw', username: 'ann' }),
    )
    expect(seen).toEqual([`Bearer ${TOKEN}`, `Basic ${Buffer.from('ann:pw').toString('base64')}`])
  })

  it('refuses to call without credentials, without calling the host', async () => {
    let called = false
    const bb = new BitbucketCloud({
      apiUrl: API,
      fetch: async () => {
        called = true
        return Response.json({})
      },
    })
    for (const bad of [undefined, 'not json', '{}']) {
      // eslint-disable-next-line no-await-in-loop -- in order
      const err = await bb.listRepositories('acme', bad).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderApiError)
      expect(isConnectionRevoked(err)).toBe(false)
    }
    expect(called).toBe(false)
  })

  it('treats 401 as a revoked connection and other failures as retryable', async () => {
    const revoked = await answer(401)
      .listRepositories('acme', credentials)
      .catch((e: unknown) => e)
    expect(isConnectionRevoked(revoked)).toBe(true)
    for (const status of [403, 404, 500]) {
      // eslint-disable-next-line no-await-in-loop -- in order
      const err = await answer(status)
        .listRepositories('acme', credentials)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderApiError)
      expect(isConnectionRevoked(err)).toBe(false)
      expect(err).toMatchObject({ status })
    }
  })

  it('finds the summary comment on a later page of the pull request', async () => {
    const fake = fakeBitbucketHost({
      workspace: 'acme',
      repos: [],
      token: TOKEN,
    })
    const bb = new BitbucketCloud({ apiUrl: API, fetch: fake.fetcher })
    for (const raw of ['one', 'two', 'three']) {
      // eslint-disable-next-line no-await-in-loop -- in order
      await bb.reply('acme', 'acme/web', 7, raw, credentials)
    }
    await bb.reply('acme', 'acme/web', 7, '<!-- circi:pr-summary --> hi', credentials)
    const id = await bb.upsertComment(
      'acme',
      'acme/web',
      7,
      '<!-- circi:pr-summary --> new',
      undefined,
      credentials,
    )
    expect(fake.host.comments()).toEqual(['one', 'two', 'three', '<!-- circi:pr-summary --> new'])
    expect(id).toBeTruthy()
  })
})

const sign = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

describe('Bitbucket webhook signatures', () => {
  it('accepts exactly the body signed with the secret', () => {
    const body = '{"pullrequest":{"id":1}}'
    expect(verifyBitbucketSignature('k', body, sign('k', body))).toBe(true)
    expect(verifyBitbucketSignature('k', Buffer.from(body), sign('k', body))).toBe(true)
    expect(verifyBitbucketSignature('k', `${body}x`, sign('k', body))).toBe(false)
    expect(verifyBitbucketSignature('other', body, sign('k', body))).toBe(false)
  })

  it('rejects a missing, malformed or wrong-length signature', () => {
    expect(verifyBitbucketSignature('k', 'x', undefined)).toBe(false)
    expect(verifyBitbucketSignature('k', 'x', '')).toBe(false)
    expect(verifyBitbucketSignature('k', 'x', 'sha1=abcd')).toBe(false)
    expect(verifyBitbucketSignature('k', 'x', 'sha256=zz')).toBe(false)
    expect(verifyBitbucketSignature('k', 'x', 'sha256=abcd')).toBe(false)
    expect(verifyBitbucketSignature('k', 'x', sign('k', 'x').toUpperCase())).toBe(false)
  })

  it('reads the header (a list too), and refuses everything without a secret', () => {
    const body = '{}'
    expect(
      bitbucketWebhookVerifier('k').verifyWebhook(body, {
        'x-hub-signature': [sign('k', body)],
      }),
    ).toBe(true)
    // GitHub's header is not Bitbucket's.
    expect(
      bitbucketWebhookVerifier('k').verifyWebhook(body, {
        'x-hub-signature-256': sign('k', body),
      }),
    ).toBe(false)
    expect(
      new BitbucketCloud().verifyWebhook(body, {
        'x-hub-signature': sign('', body),
      }),
    ).toBe(false)
  })
})
