/**
 * A fake of the part of GitLab's REST edge the server routes touch: who the token is, the
 * projects it can see, and what was written to merge requests. Tokens: `good` (user 7), `other`
 * (user 8); anything else is a 401. Nothing here talks to a real GitLab.
 */
const json = (data: unknown, status = 200) => Response.json(data, { status })

export function fakeGitlab() {
  const writes: { method: string; path: string; body: unknown }[] = []
  let down = false
  const users: Record<string, number> = { good: 7, other: 8 }
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const path = decodeURIComponent(
      new URL(req.url).pathname.replace(/^\/.*?\/api\/v4|^\/api\/v4/, ''),
    )
    if (down) return json({ message: 'down' }, 503)
    const token = req.headers.get('private-token') ?? ''
    if (!(token in users)) return json({ message: '401 Unauthorized' }, 401)
    if (req.method === 'GET' && path === '/user') return json({ id: users[token], username: token })
    if (req.method === 'GET' && path === '/projects') {
      return json([
        { path_with_namespace: 'acme/web', visibility: 'private' },
        { path_with_namespace: 'acme/tools/oss', visibility: 'public' },
      ])
    }
    const body: unknown = req.body ? JSON.parse(await req.text()) : undefined
    writes.push({ method: req.method, path, body })
    return json({ id: writes.length }, 201)
  }
  return {
    fetcher,
    writes,
    setDown: (value: boolean) => {
      down = value
    },
  }
}
