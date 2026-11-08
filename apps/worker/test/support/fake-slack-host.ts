import { SlackClient } from '@circi/providers'

export interface PostedMessage {
  token: string
  channel: string
  text: string
  blocks: unknown[]
}

/**
 * A stateful fake of Slack's HTTP edge: `chat.postMessage` for the tokens it knows, `invalid_auth`
 * for others, and `token_revoked` once `revoke` was called on a token. Records every message.
 * Used through a real `SlackClient`, so the client's request and error handling is exercised.
 */
export function fakeSlackHost(validTokens: string[]) {
  const posted: PostedMessage[] = []
  const revoked = new Set<string>()
  const fetcher: typeof fetch = async (input, init) => {
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
  return {
    client: new SlackClient({ fetch: fetcher, apiUrl: 'https://slack.test/api' }),
    posted,
    revoke: (token: string) => revoked.add(token),
  }
}
