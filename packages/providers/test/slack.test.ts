import { describe, expect, it } from 'vitest'

import { isSlackRevoked, SlackApiError, SlackClient } from '#src/index.ts'

interface Seen {
  url: string
  auth: string | null
  type: string | null
  body: string
}

/** Scripted Slack edge: answers each call in order and records what was sent. */
function scripted(...answers: (Response | Record<string, unknown>)[]) {
  const seen: Seen[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    seen.push({
      url: req.url,
      auth: req.headers.get('authorization'),
      type: req.headers.get('content-type'),
      body: await req.text(),
    })
    const next = answers.shift()
    if (!next) throw new Error('unexpected call')
    return next instanceof Response ? next : Response.json(next)
  }
  return { client: new SlackClient({ fetch: fetcher, apiUrl: 'https://slack.test/api/' }), seen }
}

describe('SlackClient', () => {
  it('exchanges the install code for the workspace and its bot token', async () => {
    const { client, seen } = scripted({
      ok: true,
      access_token: 'xoxb-1',
      bot_user_id: 'U9',
      team: { id: 'T1', name: 'Acme' },
    })
    const install = await client.exchangeCode({
      clientId: 'cid',
      clientSecret: 'secret',
      code: 'abc',
      redirectUri: 'https://ci.acme.io/api/integrations/slack/callback',
    })
    expect(install).toEqual({ teamId: 'T1', teamName: 'Acme', botToken: 'xoxb-1', botUserId: 'U9' })
    expect(seen[0]?.url).toBe('https://slack.test/api/oauth.v2.access')
    const form = new URLSearchParams(seen[0]?.body)
    expect(form.get('code')).toBe('abc')
    expect(form.get('client_secret')).toBe('secret')
  })

  it('builds the authorize url with scopes, redirect and state', () => {
    const url = new URL(
      new SlackClient().authorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://x/cb',
        state: 's.t',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('scope')).toContain('chat:write')
    expect(url.searchParams.get('state')).toBe('s.t')
  })

  it('posts a message as JSON with the bearer token', async () => {
    const { client, seen } = scripted({ ok: true, ts: '171.1' })
    const ts = await client.postMessage('xoxb-1', { channel: 'C1', text: 'hi', blocks: [] })
    expect(ts).toBe('171.1')
    expect(seen[0]?.auth).toBe('Bearer xoxb-1')
    expect(JSON.parse(seen[0]?.body ?? '')).toMatchObject({ channel: 'C1', text: 'hi' })
  })

  it('pages through conversations.list and sorts the channels', async () => {
    const { client, seen } = scripted(
      {
        ok: true,
        channels: [{ id: 'C2', name: 'zeta', is_private: false }],
        response_metadata: { next_cursor: 'next' },
      },
      { ok: true, channels: [{ id: 'G1', name: 'alpha', is_private: true }] },
    )
    expect(await client.listChannels('t')).toEqual([
      { id: 'G1', name: 'alpha', private: true },
      { id: 'C2', name: 'zeta', private: false },
    ])
    expect(new URLSearchParams(seen[1]?.body).get('cursor')).toBe('next')
  })

  it('reads auth.test', async () => {
    const { client } = scripted({ ok: true, team_id: 'T1', team: 'Acme', user_id: 'U9' })
    expect(await client.authTest('t')).toEqual({ teamId: 'T1', team: 'Acme', botUserId: 'U9' })
  })

  it('marks token errors as revoked and others not', async () => {
    for (const code of ['invalid_auth', 'token_revoked', 'account_inactive']) {
      const { client } = scripted({ ok: false, error: code })
      // eslint-disable-next-line no-await-in-loop -- three cases in order
      const err = await client.authTest('t').catch((e: unknown) => e)
      expect(isSlackRevoked(err)).toBe(true)
    }
    const { client } = scripted({ ok: false, error: 'channel_not_found' })
    const err = await client
      .postMessage('t', { channel: 'C', text: '', blocks: [] })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SlackApiError)
    expect(isSlackRevoked(err)).toBe(false)
    expect(err).toMatchObject({ code: 'channel_not_found' })
  })

  it('reports rate limits and server errors as errors to retry', async () => {
    const { client } = scripted(
      new Response('', { status: 429, headers: { 'retry-after': '7' } }),
      new Response('', { status: 503 }),
    )
    const limited = await client.authTest('t').catch((e: unknown) => e)
    expect(limited).toMatchObject({ code: 'ratelimited', retryAfter: 7, revoked: false })
    const down = await client.authTest('t').catch((e: unknown) => e)
    expect(down).toMatchObject({ code: 'http_503' })
  })
})
