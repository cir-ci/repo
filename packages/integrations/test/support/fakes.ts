import type { IntegrationDefinition } from '#src/index.ts'

/** Fetch-level fakes of the providers' HTTP edges, shared by the per-kind tests and the contract harnesses. */

/** Linear's and Jira's HTTP edges in one fetch: the calls the adapters make, 401 for a bad key. */
export function fakeTrackers(options: { down?: boolean } = {}) {
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

/** Slack's HTTP edge: records posts, answers the OAuth exchange and the channel list. */
export function fakeSlack() {
  const posts: Record<string, unknown>[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const method = new URL(req.url).pathname.split('/').at(-1)
    const text = await req.text()
    if (method === 'oauth.v2.access') {
      return new URLSearchParams(text).get('code') === 'good'
        ? Response.json({
            ok: true,
            access_token: 'xoxb-1',
            team: { id: 'T1', name: 'Acme' },
          })
        : Response.json({ ok: false, error: 'invalid_code' })
    }
    if (method === 'chat.postMessage') {
      posts.push(JSON.parse(text))
      return Response.json({ ok: true, ts: '1.0' })
    }
    if (method === 'conversations.list') {
      return Response.json({
        ok: true,
        channels: [
          { id: 'C2', name: 'zeta', is_private: false },
          { id: 'G1', name: 'alpha', is_private: true },
        ],
      })
    }
    return new Response('boom', { status: 500 })
  }
  const ctx: IntegrationDefinition.Context = {
    authSecret: 'a-long-instance-secret-for-tests-0123456789',
    publicOrigin: 'https://ci.acme.io',
    config: { slack: { clientId: 'cid', clientSecret: 'cs', apiUrl: 'https://slack.test/api' } },
    fetch: fetcher,
  }
  return { posts, ctx }
}

/** Figma's HTTP edge: one token, one file with a page and two frames, comments kept. */
export function fakeFigma(options: { down?: boolean } = {}) {
  const comments: unknown[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (options.down) return new Response('boom', { status: 500 })
    if (req.headers.get('x-figma-token') !== 'figd_good') {
      return Response.json({ err: 'Invalid token' }, { status: 403 })
    }
    if (url.pathname === '/v1/me') return Response.json({ id: 'fu-1', handle: 'michael' })
    if (url.pathname.startsWith('/v1/images/')) {
      return Response.json({ images: { '1:2': 'https://img.test/cart.png' } })
    }
    if (url.pathname.endsWith('/comments')) {
      comments.push(await req.json())
      return Response.json({ id: 'c1' })
    }
    if (!url.pathname.startsWith('/v1/files/FileKey12345')) {
      return Response.json({ err: 'Not found' }, { status: 404 })
    }
    if (url.pathname.endsWith('/nodes')) {
      const ids = (url.searchParams.get('ids') ?? '').split(',')
      const nodes = {
        '0:1': {
          document: {
            id: '0:1',
            name: 'Pages',
            children: [
              { id: '1:1', name: 'Home', type: 'FRAME' },
              { id: '1:2', name: 'Cart', type: 'FRAME' },
            ],
          },
        },
        '1:2': { document: { id: '1:2', name: 'Cart', type: 'FRAME', children: [] } },
      }
      return Response.json({
        nodes: Object.fromEntries(ids.map((id) => [id, Reflect.get(nodes, id) ?? null])),
      })
    }
    return Response.json({
      name: 'Checkout v3',
      document: { id: '0:0', name: 'Document', children: [{ id: '0:1', name: 'Pages' }] },
    })
  }
  const ctx: IntegrationDefinition.Context = {
    authSecret: 'a-long-instance-secret-for-tests-0123456789',
    publicOrigin: 'https://ci.acme.io',
    config: {},
    fetch: fetcher,
  }
  return { ctx, comments }
}

/** GitLab's REST edge for `connect`: the user and the project list, 401 for any other token. */
export function fakeGitlab(token: string): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (req.headers.get('private-token') !== token) {
      return Response.json({ message: '401 Unauthorized' }, { status: 401 })
    }
    if (url.pathname.endsWith('/user')) return Response.json({ id: 7, username: 'circi-bot' })
    return Response.json([])
  }
}

/** Bitbucket Cloud's edge for `connect`: the repository list, 401 for any other bearer token. */
export function fakeBitbucket(token: string): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init)
    if (req.headers.get('authorization') !== `Bearer ${token}`) {
      return Response.json(
        { type: 'error', error: { message: 'Bad credentials' } },
        { status: 401 },
      )
    }
    return Response.json({ values: [] })
  }
}
