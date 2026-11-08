import { createHmac } from 'node:crypto'

const json = (data: unknown, status = 200) => Response.json(data, { status })

/**
 * A stateful fake of GitHub's HTTP edge: just the endpoints the adapter uses, with the behaviour
 * the adapter depends on (ids, 404 for a deleted comment, 404 for an uninstalled installation).
 * Different from the scripted fake in github.test.ts, which pins exact requests.
 */
export function fakeGithubHost(options: { installationId: string; repos: string[] }) {
  let nextId = 100
  const checks = new Set<number>()
  let comments: { id: number; body: string }[] = []
  let revoked = false

  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const path = url.pathname
    const body: unknown = req.body ? JSON.parse(await req.text()) : undefined

    if (
      req.method === 'POST' &&
      path === `/app/installations/${options.installationId}/access_tokens`
    ) {
      return revoked
        ? json({ message: 'Not Found' }, 404)
        : json({ token: 'ghs_fake', expires_at: new Date(Date.now() + 3600_000).toISOString() })
    }
    if (req.method === 'POST' && path.endsWith('/check-runs')) {
      const id = nextId++
      checks.add(id)
      return json({ id }, 201)
    }
    const check = /\/check-runs\/(\d+)$/.exec(path)
    if (req.method === 'PATCH' && check) {
      const id = Number(check[1])
      return checks.has(id) ? json({ id }) : json({ message: 'Not Found' }, 404)
    }
    if (req.method === 'GET' && /\/issues\/\d+\/comments$/.test(path)) return json(comments)
    if (req.method === 'POST' && /\/issues\/\d+\/comments$/.test(path)) {
      const comment = { id: nextId++, body: String(Reflect.get(Object(body), 'body')) }
      comments.push(comment)
      return json(comment, 201)
    }
    const comment = /\/issues\/comments\/(\d+)$/.exec(path)
    if (req.method === 'PATCH' && comment) {
      const found = comments.find((c) => c.id === Number(comment[1]))
      if (!found) return json({ message: 'Not Found' }, 404)
      found.body = String(Reflect.get(Object(body), 'body'))
      return json(found)
    }
    if (req.method === 'GET' && path === '/installation/repositories') {
      return json({
        total_count: options.repos.length,
        repositories: options.repos.map((full_name) => ({
          full_name,
          private: full_name.endsWith('-private'),
        })),
      })
    }
    return json({ message: `unhandled ${req.method} ${path}` }, 500)
  }

  return {
    fetcher,
    host: {
      statusCount: () => checks.size,
      comments: () => comments.map((c) => c.body),
      deleteComments: () => {
        comments = []
      },
      revoke: () => {
        revoked = true
      },
    },
    sign: (secret: string, body: string) => ({
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    }),
  }
}
