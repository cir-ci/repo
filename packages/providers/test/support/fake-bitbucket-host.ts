import { createHmac } from 'node:crypto'

const json = (data: unknown, status = 200) => Response.json(data, { status })

/**
 * A stateful fake of Bitbucket Cloud's HTTP edge: the endpoints the adapter uses, with the
 * behaviour it depends on (statuses overwritten by key, 404 for a deleted comment, paged lists,
 * 401 for a revoked token). Requests must carry the bearer token the fake was given.
 */
export function fakeBitbucketHost(options: { workspace: string; repos: string[]; token: string }) {
  let nextId = 10
  const statuses = new Map<string, unknown>()
  let comments: { id: number; raw: string }[] = []
  let revoked = false
  const requests: {
    method: string
    url: string
    authorization: string | null
  }[] = []

  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const path = url.pathname
    requests.push({
      method: req.method,
      url: `${path}${url.search}`,
      authorization: req.headers.get('authorization'),
    })
    if (revoked || req.headers.get('authorization') !== `Bearer ${options.token}`) {
      return json({ type: 'error', error: { message: 'Bad credentials' } }, 401)
    }
    const body: unknown = req.body ? JSON.parse(await req.text()) : undefined
    const raw = String(Reflect.get(Object(Reflect.get(Object(body), 'content')), 'raw') ?? '')

    const status = /\/commit\/([^/]+)\/statuses\/build$/.exec(path)
    if (req.method === 'POST' && status) {
      const key = String(Reflect.get(Object(body), 'key'))
      statuses.set(`${status[1]}:${key}`, body)
      return json({ key }, 201)
    }
    const list = /\/pullrequests\/\d+\/comments$/.exec(path)
    if (req.method === 'GET' && list) {
      // Two to a page, to make the adapter follow `next`.
      const page = Number(url.searchParams.get('page') ?? '1')
      const slice = comments.slice((page - 1) * 2, page * 2)
      const more = comments.length > page * 2
      return json({
        values: slice.map((c) => ({ id: c.id, content: { raw: c.raw } })),
        ...(more
          ? {
              next: `https://api.bitbucket.test${path}?pagelen=100&page=${page + 1}`,
            }
          : {}),
      })
    }
    if (req.method === 'POST' && list) {
      const comment = { id: nextId++, raw }
      comments.push(comment)
      return json({ id: comment.id }, 201)
    }
    const one = /\/pullrequests\/\d+\/comments\/(\d+)$/.exec(path)
    if (req.method === 'PUT' && one) {
      const found = comments.find((c) => c.id === Number(one[1]))
      if (!found) return json({ type: 'error', error: { message: 'Not found' } }, 404)
      found.raw = raw
      return json({ id: found.id })
    }
    if (req.method === 'GET' && path === `/2.0/repositories/${options.workspace}`) {
      const page = Number(url.searchParams.get('page') ?? '1')
      const slice = options.repos.slice((page - 1) * 1, page * 1)
      return json({
        values: slice.map((full_name) => ({
          full_name,
          is_private: full_name.endsWith('-private'),
        })),
        ...(options.repos.length > page
          ? {
              next: `https://api.bitbucket.test${path}?pagelen=100&page=${page + 1}`,
            }
          : {}),
      })
    }
    return json({ type: 'error', error: { message: `unhandled ${req.method} ${path}` } }, 500)
  }

  return {
    fetcher,
    requests,
    host: {
      statusCount: () => statuses.size,
      comments: () => comments.map((c) => c.raw),
      deleteComments: () => {
        comments = []
      },
      revoke: () => {
        revoked = true
      },
    },
    sign: (secret: string, body: string) => ({
      'x-hub-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    }),
  }
}
