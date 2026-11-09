import { fakeHost, jsonResponse as json } from './types.ts'
/**
 * Stateful fakes of Linear's and Jira's HTTP edges: just the calls the adapters make, with the
 * behaviour they depend on (keys that count up, 401 for bad credentials, errors for unknown
 * teams and projects). External services are never contacted by the tests.
 */

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? { ...v } : {}

export interface FakeIssue {
  key: string
  target: string
  title: string
  text: string
}

export function fakeLinearHost(options: {
  apiKey: string
  organization: { id: string; name: string }
  teams: { id: string; key: string; name: string }[]
}) {
  const issues: (FakeIssue & { id: string })[] = []
  const attachments: { issueId: string; url: string }[] = []
  const counters = new Map<string, number>()

  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    if (req.headers.get('authorization') !== options.apiKey) {
      return json({ errors: [{ message: 'Authentication required' }] }, 401)
    }
    const payload = record(await req.json())
    const query = String(payload.query)
    const args = Object.fromEntries(
      Object.entries(record(record(payload.variables).input)).map(([k, v]) => [k, String(v)]),
    )
    if (query.includes('viewer')) {
      return json({
        data: { viewer: { id: 'u1', organization: options.organization } },
      })
    }
    if (query.includes('teams')) return json({ data: { teams: { nodes: options.teams } } })
    if (query.includes('issueCreate')) {
      const team = options.teams.find((t) => t.id === args.teamId)
      if (!team) return json({ errors: [{ message: 'Team not found' }] })
      const n = (counters.get(team.id) ?? 0) + 1
      counters.set(team.id, n)
      const key = `${team.key}-${n}`
      issues.push({
        id: `lin-${key}`,
        key,
        target: team.id,
        title: args.title ?? '',
        text: args.description ?? '',
      })
      return json({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: `lin-${key}`,
              identifier: key,
              url: `https://linear.app/acme/issue/${key}`,
              title: args.title,
            },
          },
        },
      })
    }
    if (query.includes('attachmentCreate')) {
      attachments.push({ issueId: args.issueId ?? '', url: args.url ?? '' })
      return json({ data: { attachmentCreate: { success: true } } })
    }
    return json({ errors: [{ message: 'Unknown query' }] })
  }

  return {
    ...fakeHost(behaviour),
    host: {
      issues: (): FakeIssue[] => issues.map(({ id: _id, ...rest }) => rest),
      attachments: () => [...attachments],
    },
  }
}

/** Flattens an ADF node's text, links included. */
function adfText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const n = node as { text?: string; content?: unknown[] }
  return (n.text ?? '') + (n.content ?? []).map(adfText).join('\n')
}

export function fakeJiraHost(options: {
  /** Expected `Authorization` header. */
  authorization: string
  projects: { key: string; name: string }[]
}) {
  const issues: FakeIssue[] = []
  const issueTypes: string[] = []
  const counters = new Map<string, number>()

  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const path = new URL(req.url).pathname.replace(/^.*(?=\/rest\/api\/3)/, '')
    if (req.headers.get('authorization') !== options.authorization) {
      return json({ message: 'Unauthorized' }, 401)
    }
    if (req.method === 'GET' && path === '/rest/api/3/myself') {
      return json({ accountId: 'a1', displayName: 'CirCI' })
    }
    if (req.method === 'GET' && path === '/rest/api/3/project') return json(options.projects)
    if (req.method === 'POST' && path === '/rest/api/3/issue') {
      const fields = record(record(await req.json()).fields)
      const projectKey = String(record(fields.project).key)
      if (!options.projects.some((p) => p.key === projectKey)) {
        return json(
          {
            errorMessages: [],
            errors: { project: 'valid project is required' },
          },
          400,
        )
      }
      const n = (counters.get(projectKey) ?? 0) + 1
      counters.set(projectKey, n)
      const key = `${projectKey}-${n}`
      issueTypes.push(String(record(fields.issuetype).name))
      issues.push({
        key,
        target: projectKey,
        title: typeof fields.summary === 'string' ? fields.summary : '',
        text: adfText(fields.description),
      })
      return json(
        {
          id: String(issues.length),
          key,
          self: `https://x/rest/api/3/issue/${key}`,
        },
        201,
      )
    }
    return json({ errorMessages: ['not found'] }, 404)
  }

  return {
    ...fakeHost(behaviour),
    host: { issues: () => [...issues], issueTypes: () => [...issueTypes] },
  }
}

/** Linear's and Jira's HTTP edges in one fetch: the calls the adapters make, 401 for a bad key. */
export function fakeTrackersHost(options: { down?: boolean } = {}) {
  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const text = await req.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    const auth = req.headers.get('authorization')
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
  return fakeHost(behaviour)
}
