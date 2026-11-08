import { describe, expect, it } from 'vitest'

import {
  credentialFields,
  IntegrationUnreachableError,
  integrationRegistry,
  InvalidCredentialsError,
  mappingSpec,
} from '#src/index.ts'
import type { IntegrationDefinition } from '#src/index.ts'

const linear = integrationRegistry.get('linear')
const jira = integrationRegistry.get('jira')
if (!linear || !jira) throw new Error('the trackers are registered')

/** Linear's and Jira's HTTP edges in one fetch: the calls the adapters make, 401 for a bad key. */
function fakeTrackers(options: { down?: boolean } = {}) {
  const calls: { url: string; auth: string | null; body: unknown }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const text = await req.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    const auth = req.headers.get('authorization')
    calls.push({ url: url.host + url.pathname, auth, body })
    if (options.down) return new Response('boom', { status: 503 })
    if (url.host === 'api.linear.app') {
      if (auth !== 'lin_good')
        return Response.json({ errors: [{ message: 'no' }] }, { status: 401 })
      const query = String(Reflect.get(Object(body), 'query'))
      if (query.includes('viewer')) {
        return Response.json({
          data: { viewer: { id: 'u1', organization: { id: 'workspace-1', name: 'Acme Linear' } } },
        })
      }
      return Response.json({
        data: { teams: { nodes: [{ id: 'team-1', key: 'WEB', name: 'Web' }] } },
      })
    }
    if (!auth?.startsWith('Basic ')) return Response.json({}, { status: 401 })
    if (auth !== `Basic ${Buffer.from('me@acme.test:jira-good').toString('base64')}`) {
      return Response.json({ errorMessages: ['bad'] }, { status: 401 })
    }
    if (url.pathname.endsWith('/myself')) return Response.json({ accountId: 'a1' })
    return Response.json([{ key: 'WEB', name: 'Website' }])
  }
  const ctx: IntegrationDefinition.Context = {
    authSecret: 'a-long-instance-secret-for-tests-0123456789',
    publicOrigin: 'https://ci.acme.io',
    config: {},
    fetch: fetcher,
  }
  return { calls, ctx }
}

describe('linear', () => {
  it('connects with an API key and stores the credentials as JSON', async () => {
    const { ctx, calls } = fakeTrackers()
    const connected = await linear.connect?.({ apiKey: 'lin_good' }, ctx)
    expect(connected).toEqual({
      externalId: 'workspace-1',
      displayName: 'Acme Linear',
      credentials: JSON.stringify({ kind: 'linear', apiKey: 'lin_good' }),
    })
    expect(calls[0]?.auth).toBe('lin_good')
  })

  it('answers 400 for a refused key and 502 when Linear is down', async () => {
    const { ctx } = fakeTrackers()
    await expect(linear.connect?.({ apiKey: 'nope' }, ctx)).rejects.toThrow(
      new InvalidCredentialsError('Linear did not accept those credentials'),
    )
    await expect(
      linear.connect?.({ apiKey: 'lin_good' }, fakeTrackers({ down: true }).ctx),
    ).rejects.toBeInstanceOf(IntegrationUnreachableError)
  })

  it('lists the Jira projects as targets and builds its tracker from the stored credentials', async () => {
    const { ctx } = fakeTrackers()
    const credentials = JSON.stringify({ kind: 'linear', apiKey: 'lin_good' })
    expect(await linear.mapping?.listTargets?.(credentials, ctx)).toEqual([
      { id: 'team-1', name: 'Web (WEB)' },
    ])
    expect(linear.capabilities.tracker?.create(credentials, ctx)?.kind).toBe('linear')
    expect(linear.capabilities.tracker?.create('not json', ctx)).toBeUndefined()
  })

  it('asks for a team, nothing else, and has the key as a secret field', () => {
    expect(mappingSpec(linear.mapping)).toMatchObject({
      targetLabel: 'Team',
      targetKind: 'select',
      fields: [],
    })
    expect(credentialFields(linear.credentials)).toMatchObject([
      { name: 'apiKey', label: 'API key', secret: true },
    ])
  })
})

describe('jira', () => {
  const form = { siteUrl: 'acme.atlassian.net', email: 'me@acme.test', apiToken: 'jira-good' }

  it('connects with site, email and token, normalising the site to its https origin', async () => {
    const { ctx, calls } = fakeTrackers()
    const connected = await jira.connect?.(form, ctx)
    expect(connected).toEqual({
      externalId: 'acme.atlassian.net',
      displayName: 'acme.atlassian.net',
      credentials: JSON.stringify({
        kind: 'jira',
        siteUrl: 'https://acme.atlassian.net',
        email: 'me@acme.test',
        apiToken: 'jira-good',
      }),
    })
    expect(calls[0]?.url).toBe('acme.atlassian.net/rest/api/3/myself')
  })

  it.each([
    'http://acme.atlassian.net',
    'localhost',
    '10.0.0.5',
    'intranet',
    'host.local',
    'not a url',
  ])('refuses %s as a site, before calling anything', async (siteUrl) => {
    const { ctx, calls } = fakeTrackers()
    const result = jira.connect?.({ ...form, siteUrl }, ctx)
    await expect(result).rejects.toBeInstanceOf(InvalidCredentialsError)
    await expect(result).rejects.toThrow(/https address of your Jira Cloud site/)
    expect(calls).toEqual([])
  })

  it('answers 400 for refused credentials and 502 when Jira is down', async () => {
    await expect(jira.connect?.({ ...form, apiToken: 'bad' }, fakeTrackers().ctx)).rejects.toThrow(
      new InvalidCredentialsError('Jira did not accept those credentials'),
    )
    await expect(jira.connect?.(form, fakeTrackers({ down: true }).ctx)).rejects.toBeInstanceOf(
      IntegrationUnreachableError,
    )
  })

  it('lists the Jira projects as targets', async () => {
    const credentials = JSON.stringify({
      kind: 'jira',
      siteUrl: 'https://acme.atlassian.net',
      email: 'me@acme.test',
      apiToken: 'jira-good',
    })
    expect(await jira.mapping?.listTargets?.(credentials, fakeTrackers().ctx)).toEqual([
      { id: 'WEB', name: 'Website (WEB)' },
    ])
  })
})

describe('the trackers’ needs-attention rule', () => {
  it('flags a 401 or 403 from the tracker, and nothing else', async () => {
    const { ctx } = fakeTrackers()
    const credentials = JSON.stringify({ kind: 'linear', apiKey: 'revoked' })
    const err = await linear.mapping?.listTargets?.(credentials, ctx).catch((e: unknown) => e)
    expect(linear.needsAttention(err)).toBe('Linear no longer accepts the saved credentials')
    expect(jira.needsAttention(err)).toBe('Jira no longer accepts the saved credentials')
    expect(linear.needsAttention(new Error('socket hang up'))).toBeNull()
    const down = await linear.mapping
      ?.listTargets?.(credentials, fakeTrackers({ down: true }).ctx)
      .catch((e: unknown) => e)
    expect(linear.needsAttention(down)).toBeNull()
  })
})
