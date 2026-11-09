import { fakeHost, jsonResponse as json } from './types.ts'

/**
 * A stateful fake of GitLab's REST edge (`/api/v4`): token check (401 once revoked), commit
 * statuses keyed by commit and name (re-posting replaces, as GitLab does), merge request notes
 * (404 for a deleted one), the user and the projects the token is a member of.
 */
export function fakeGitlabHost(options: {
  token: string
  userId?: number
  projects: { path: string; visibility: 'public' | 'private' }[]
}) {
  let nextId = 100
  const statuses = new Map<string, { id: number; state: string; name: string; sha: string }>()
  let notes: { id: number; body: string }[] = []
  const awards: string[] = []
  let revoked = false
  const requests: { method: string; path: string; body: unknown }[] = []

  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname.replace(/^\/api\/v4/, ''))
    const body: unknown = req.body ? JSON.parse(await req.text()) : undefined
    requests.push({ method: req.method, path, body })
    if (revoked || req.headers.get('private-token') !== options.token) {
      return json({ message: '401 Unauthorized' }, 401)
    }
    if (req.method === 'GET' && path === '/user') {
      return json({ id: options.userId ?? 7, username: 'circi-bot' })
    }
    if (req.method === 'GET' && path === '/projects') {
      const page = Number(url.searchParams.get('page') ?? '1')
      const per = Number(url.searchParams.get('per_page') ?? '20')
      return json(
        options.projects.slice((page - 1) * per, page * per).map((p) => ({
          path_with_namespace: p.path,
          visibility: p.visibility,
        })),
      )
    }
    const status = /^\/projects\/(.+)\/statuses\/([^/]+)$/.exec(path)
    if (req.method === 'POST' && status) {
      const name = String(Reflect.get(Object(body), 'name'))
      const key = `${status[1]}:${status[2]}:${name}`
      const state = String(Reflect.get(Object(body), 'state'))
      const existing = statuses.get(key)
      const row = existing ?? {
        id: nextId++,
        state,
        name,
        sha: String(status[2]),
      }
      row.state = state
      statuses.set(key, row)
      return json(row, 201)
    }
    const award = /^\/projects\/.+\/merge_requests\/\d+\/notes\/\d+\/award_emoji$/.exec(path)
    if (req.method === 'POST' && award) {
      awards.push(String(Reflect.get(Object(body), 'name')))
      return json({ id: nextId++ }, 201)
    }
    if (req.method === 'GET' && /\/merge_requests\/\d+\/notes$/.test(path)) return json(notes)
    if (req.method === 'POST' && /\/merge_requests\/\d+\/notes$/.test(path)) {
      const note = {
        id: nextId++,
        body: String(Reflect.get(Object(body), 'body')),
      }
      notes.push(note)
      return json(note, 201)
    }
    const note = /\/merge_requests\/\d+\/notes\/(\d+)$/.exec(path)
    if (req.method === 'PUT' && note) {
      const found = notes.find((n) => n.id === Number(note[1]))
      if (!found) return json({ message: '404 Not found' }, 404)
      found.body = String(Reflect.get(Object(body), 'body'))
      return json(found)
    }
    return json({ message: `unhandled ${req.method} ${path}` }, 500)
  }

  return {
    ...fakeHost(behaviour),
    requests,
    host: {
      statusCount: () => statuses.size,
      stateOf: (name: string) => [...statuses.values()].find((s) => s.name === name)?.state,
      comments: () => notes.map((n) => n.body),
      awards: () => [...awards],
      deleteComments: () => {
        notes = []
      },
      revoke: () => {
        revoked = true
      },
    },
  }
}
