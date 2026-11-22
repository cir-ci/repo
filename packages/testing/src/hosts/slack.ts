import { fakeHost } from './types.ts'
export interface PostedMessage {
  token: string
  channel: string
  text: string
  blocks: unknown[]
}

/**
 * A stateful fake of Slack's HTTP edge: `chat.postMessage` for the tokens it knows, `invalid_auth`
 * for others, and `token_revoked` once `revoke` was called on a token. Records every message.
 * Used through the Slack definition's real `SlackClient`, so the client's request and error handling is exercised.
 */
export function fakeSlackHost(validTokens: string[]) {
  const posted: PostedMessage[] = []
  const revoked = new Set<string>()
  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const method = new URL(req.url).pathname.split('/').at(-1)
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
    if (revoked.has(token)) return Response.json({ ok: false, error: 'token_revoked' })
    if (!validTokens.includes(token)) return Response.json({ ok: false, error: 'invalid_auth' })
    if (method === 'chat.postMessage') {
      const body: Record<string, unknown> = Object.fromEntries(
        Object.entries(JSON.parse(await req.text())),
      )
      posted.push({
        token,
        channel: typeof body.channel === 'string' ? body.channel : '',
        text: typeof body.text === 'string' ? body.text : '',
        blocks: Array.isArray(body.blocks) ? body.blocks : [],
      })
      return Response.json({ ok: true, ts: `${posted.length}.0` })
    }
    return Response.json({ ok: false, error: 'unknown_method' })
  }
  const base = fakeHost(behaviour)
  return {
    ...base,
    /** The integration context for this host: Slack's API address and `fetch` point at the fake. */
    integrations: {
      config: {
        slack: { clientId: 'cid', clientSecret: 'csecret', apiUrl: 'https://slack.test/api' },
      },
      fetch: base.fetcher,
    },
    posted,
    revoke: (token: string) => revoked.add(token),
  }
}

export namespace fakeSlackWorkspaceHost {
  export interface Options {
    /** The bot token the code `good` is exchanged for (default `xoxb-1`); `conversations.list` insists on it when given. */
    token?: string
    team?: { id: string; name: string }
    botUserId?: string
    channels?: { id: string; name: string; is_private: boolean }[]
  }
}

/**
 * Slack's HTTP edge: records posts, answers the OAuth exchange (the code `good`) and the channel
 * list. `state.revoked` makes the channel list answer `token_revoked`, as Slack does once the app
 * was removed.
 */
export function fakeSlackWorkspaceHost(options: fakeSlackWorkspaceHost.Options = {}) {
  const posts: Record<string, unknown>[] = []
  const state = { revoked: false }
  const token = options.token ?? 'xoxb-1'
  const channels = options.channels ?? [
    { id: 'C2', name: 'zeta', is_private: false },
    { id: 'G1', name: 'alpha', is_private: true },
  ]
  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const method = new URL(req.url).pathname.split('/').at(-1)
    const text = await req.text()
    if (method === 'oauth.v2.access') {
      return new URLSearchParams(text).get('code') === 'good'
        ? Response.json({
            ok: true,
            access_token: token,
            ...(options.botUserId ? { bot_user_id: options.botUserId } : {}),
            team: options.team ?? { id: 'T1', name: 'Acme' },
          })
        : Response.json({ ok: false, error: 'invalid_code' })
    }
    if (method === 'chat.postMessage') {
      posts.push(JSON.parse(text))
      return Response.json({ ok: true, ts: '1.0' })
    }
    if (method === 'conversations.list') {
      if (state.revoked) return Response.json({ ok: false, error: 'token_revoked' })
      if (options.token && req.headers.get('authorization') !== `Bearer ${options.token}`) {
        return Response.json({ ok: false, error: 'invalid_auth' })
      }
      return Response.json({ ok: true, channels })
    }
    return new Response('boom', { status: 500 })
  }
  return { ...fakeHost(behaviour), posts, state }
}
