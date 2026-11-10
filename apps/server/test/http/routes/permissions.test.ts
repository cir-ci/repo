import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Client } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'

/**
 * The permission matrix, generated from the server's own route table: every write route of the
 * dashboard API is asked as nobody, as someone outside the workspace, as a plain member and as
 * an admin. A route that is on neither list below fails the test, so a new route cannot ship
 * without someone saying who may call it.
 *
 *   signed out            401 everywhere
 *   outside the workspace 404 on team and workspace routes, and the very answer a made-up
 *                         workspace gets (a non-member must not learn that a team exists)
 *   plain member          403 on the admin-only writes; never 401/403/"not found" on the ones
 *                         a member may call
 *   admin                 passes the access check on the admin-only writes too
 *
 * The lists are derived from the access checks in `apps/server/src/http/routes/dashboard`:
 * `loadTeam(…, { manage: true })`, `loadForManager`, `managed` (owners and admins) against
 * `loadTeam`/`loadWorkspace` alone (any member).
 */

const TEAM = '/api/teams/:workspace/:team'
const WORKSPACE = '/api/workspaces/:workspace'

/** Writes any member of the workspace may make. */
const MEMBER_WRITABLE = new Set([
  `POST ${TEAM}/builds/review`,
  `POST ${TEAM}/builds/request-review`,
  `POST ${TEAM}/builds/:number/issues`,
  `POST ${TEAM}/builds/:number/review`,
  `POST ${TEAM}/builds/:number/review-requests`,
  `POST ${TEAM}/builds/:number/snapshots/review`,
  `POST ${TEAM}/builds/:number/comments`,
  `PATCH ${TEAM}/builds/:number/comments/:id`,
  `PATCH ${TEAM}/builds/:number/comments/:id/region`,
  `DELETE ${TEAM}/builds/:number/comments/:id`,
  `POST ${TEAM}/triage/assign`,
  `POST ${TEAM}/triage/snooze`,
  `POST ${TEAM}/triage/dismiss`,
  `POST ${TEAM}/triage/rerun`,
  `POST ${TEAM}/review-requests/:id/dismiss`,
  `POST ${TEAM}/review-requests/:id/nudge`,
  `POST ${TEAM}/review-requests/:id/snooze`,
  `POST ${TEAM}/review-requests/:id/unsnooze`,
  `POST ${WORKSPACE}/views`,
  `PUT ${WORKSPACE}/views/order`,
  `PATCH ${WORKSPACE}/views/:id`,
  `DELETE ${WORKSPACE}/views/:id`,
  `PUT ${WORKSPACE}/pinned-teams/:team`,
  `DELETE ${WORKSPACE}/pinned-teams/:team`,
])

/**
 * Writes owners and admins make for anyone and a member makes only for themselves (leaving a
 * team). Asked here for someone else, so a member gets 403; `team-members.test.ts` covers the rest.
 */
const SELF_OR_ADMIN = new Set([`DELETE ${TEAM}/members/:userId`])

/** Writes only owners and admins may make (members get 403). */
const ADMIN_ONLY = new Set([
  `POST ${WORKSPACE}/github-import`,
  `PUT ${WORKSPACE}/picture`,
  `DELETE ${WORKSPACE}/picture`,
  `DELETE ${TEAM}`,
  `PATCH ${TEAM}/settings`,
  `PATCH ${TEAM}/appearance`,
  `POST ${TEAM}/ignore-regions`,
  `PATCH ${TEAM}/ignore-regions/:id`,
  `DELETE ${TEAM}/ignore-regions/:id`,
  `POST ${TEAM}/token`,
  `PUT ${TEAM}/triage-rotation`,
  `PUT ${TEAM}/github`,
  `DELETE ${TEAM}/github`,
  `PUT ${TEAM}/sites/:site/domain`,
  `DELETE ${TEAM}/sites/:site/domain`,
  `POST ${TEAM}/sites/:site/domain/verify`,
  `POST ${TEAM}/members`,
  `POST ${TEAM}/webhooks`,
  `DELETE ${TEAM}/webhooks/:id`,
  `POST ${TEAM}/webhooks/:id/test`,
  `POST ${TEAM}/rules`,
  `PUT ${TEAM}/rules/order`,
  `PUT ${TEAM}/rules/:id`,
  `DELETE ${TEAM}/rules/:id`,
  `PATCH ${WORKSPACE}`,
  `DELETE ${WORKSPACE}`,
  `POST ${WORKSPACE}/teams`,
  // The tree merges `/integrations/:id` and `/integrations/:kind`; `:id` stands for both.
  `DELETE ${WORKSPACE}/integrations/:id`,
  `POST ${WORKSPACE}/integrations/:id/connect`,
  `PUT ${WORKSPACE}/integrations/:id/teams/:team`,
  `DELETE ${WORKSPACE}/integrations/:id/teams/:team`,
  `POST ${WORKSPACE}/integrations/:id/teams/:team/links`,
  `POST ${WORKSPACE}/integrations/:id/teams/:team/links/auto`,
  `DELETE ${WORKSPACE}/integrations/:id/teams/:team/links/:linkId`,
  `PATCH ${WORKSPACE}/auth`,
  `PATCH ${WORKSPACE}/settings`,
  `POST ${WORKSPACE}/sso`,
  `DELETE ${WORKSPACE}/sso/:providerId`,
  `POST ${WORKSPACE}/domains`,
  `DELETE ${WORKSPACE}/domains/:id`,
  `POST ${WORKSPACE}/domains/:id/verify`,
])

/** Writes about the signed-in user themselves, not a team or workspace: only 401 applies. */
const USER_SCOPED = new Set([
  'POST /api/workspaces',
  'POST /api/site-handoff',
  'POST /api/inbox/read-all',
  'PUT /api/inbox/preferences',
  'POST /api/inbox/:id/read',
  'POST /api/inbox/:id/snooze',
  'POST /api/inbox/:id/unsnooze',
  'DELETE /api/inbox/:id',
])

/**
 * Bodies that pass validation, for the routes that validate before they look at who asks (an
 * outsider must still get 404, not 400). Everything else is sent `{}`.
 */
const UUID = '00000000-0000-4000-8000-000000000000'
const BODIES: Record<string, unknown> = {
  [`POST ${TEAM}/builds/review`]: { buildIds: [UUID], decision: 'approved' },
  [`POST ${TEAM}/builds/request-review`]: { buildIds: [UUID], reviewerIds: ['someone'] },
  [`POST ${TEAM}/builds/:number/review`]: { state: 'approved' },
  [`POST ${TEAM}/builds/:number/review-requests`]: { reviewerId: 'someone' },
  [`POST ${TEAM}/builds/:number/snapshots/review`]: {
    snapshotNames: ['home'],
    decision: 'approved',
  },
  [`POST ${TEAM}/review-requests/:id/snooze`]: { kind: 'next_push' },
  [`POST ${WORKSPACE}/teams`]: { name: 'Another team' },
  [`POST ${TEAM}/members`]: { userIds: [] },
}

const isWrite = (method: string): method is Verb =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
type Verb = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface Route {
  method: Verb
  pattern: string
  key: string
}

/**
 * The write routes in Fastify's printed tree: each line is a path fragment that continues its
 * parent's, followed by the methods registered at that node.
 */
export function writeRoutes(tree: string): Route[] {
  const stack: string[] = []
  const routes: Route[] = []
  for (const line of tree.split('\n')) {
    const m = /^((?:│ {3}| {4})*)[├└]── (.*?) \(([^)]*)\)$/.exec(line)
    if (!m) continue
    const depth = (m[1] ?? '').length / 4
    const path = (stack[depth - 1] ?? '') + (m[2] ?? '')
    stack[depth] = path
    stack.length = depth + 1
    // `:id|:kind` is one position that two routes name differently.
    const pattern = path.replace(/:(\w+)\|:\w+/g, ':$1')
    for (const method of (m[3] ?? '').split(', ')) {
      if (isWrite(method)) routes.push({ method, pattern, key: `${method} ${pattern}` })
    }
  }
  return routes
}

let fx: Awaited<ReturnType<typeof startDashboard>>
let routes: Route[]
let member: Client
let admin: Client
let outsider: Client

beforeAll(async () => {
  fx = await startDashboard()
  routes = writeRoutes(fx.app.printRoutes({ commonPrefix: false })).filter(
    // better-auth's own endpoints take every method and answer for themselves.
    (r) => !r.pattern.startsWith('/api/auth/') && r.pattern !== '*',
  )
  member = await fx.addMember('member')
  admin = await fx.addMember('admin')
  outsider = await fx.addMember('outsider')
}, 60_000)
afterAll(() => fx.close())

function urlOf(pattern: string, workspace = fx.acme.workspaceSlug): string {
  return pattern.replace(/:(\w+)/g, (_, name: string) =>
    name === 'workspace' ? workspace : name === 'team' ? 'web' : name === 'number' ? '999' : UUID,
  )
}

const bodyOf = (key: string) => BODIES[key] ?? {}

type Scope = 'team' | 'workspace' | 'instance' | 'user' | undefined
function scopeOf({ pattern, key }: Route): Scope {
  if (pattern.startsWith(`${TEAM}/`) || pattern === TEAM) return 'team'
  if (pattern.startsWith(`${WORKSPACE}/`) || pattern === WORKSPACE) return 'workspace'
  if (pattern.startsWith('/api/instance/')) return 'instance'
  return USER_SCOPED.has(key) ? 'user' : undefined
}

describe('the route table', () => {
  it('has every write route in a list, and no stale entry', () => {
    const keys = new Set(routes.map((r) => r.key))
    const unknown = routes
      .filter(
        (r) =>
          scopeOf(r) === undefined ||
          (['team', 'workspace'].includes(scopeOf(r) ?? '') &&
            !MEMBER_WRITABLE.has(r.key) &&
            !SELF_OR_ADMIN.has(r.key) &&
            !ADMIN_ONLY.has(r.key)),
      )
      .map((r) => r.key)
    expect(unknown, 'classify these routes in permissions.test.ts').toEqual([])
    const stale = [...MEMBER_WRITABLE, ...SELF_OR_ADMIN, ...ADMIN_ONLY, ...USER_SCOPED].filter(
      (k) => !keys.has(k),
    )
    expect(stale, 'these entries match no registered route').toEqual([])
    expect(routes.length).toBeGreaterThan(60)
  })

  it('does not list a route as both member-writable and admin-only', () => {
    expect([...MEMBER_WRITABLE].filter((k) => ADMIN_ONLY.has(k))).toEqual([])
  })
})

const send = (who: Client, r: Route, workspace?: string) =>
  who.send(r.method, urlOf(r.pattern, workspace), bodyOf(r.key))

/** Runs `check` over the items at once; it returns what is wrong with an item, or nothing. */
async function problems<T>(items: T[], check: (item: T) => Promise<string | undefined>) {
  return (await Promise.all(items.map(check))).filter((p) => p !== undefined)
}

const refusedAccess = (res: { statusCode: number; body: string }) =>
  res.statusCode === 401 ||
  res.statusCode === 403 ||
  (res.statusCode === 404 && /"(Team|Workspace) not found"/.test(res.body))

describe('signed out', () => {
  it('gets 401 on every write route', async () => {
    expect(
      await problems(routes, async (r) => {
        const res = await send(fx.client.anonymous, r)
        return res.statusCode === 401 ? undefined : `${r.key} -> ${res.statusCode}`
      }),
    ).toEqual([])
  })
})

describe('instance routes', () => {
  it('refuse an account that is not an instance admin with 403', async () => {
    const instance = routes.filter((x) => scopeOf(x) === 'instance')
    expect(instance.length).toBeGreaterThan(5)
    expect(
      await problems(
        instance.flatMap((r) => [member, outsider, fx.rivalClient].map((who) => ({ r, who }))),
        async ({ r, who }) => {
          const res = await send(who, r)
          return res.statusCode === 403 ? undefined : `${r.key} -> ${res.statusCode}`
        },
      ),
    ).toEqual([])
  })
})

describe('outside the workspace', () => {
  it('gets 404 on every team and workspace write, the same answer as for a made-up workspace', async () => {
    const tenant = routes.filter((x) => ['team', 'workspace'].includes(scopeOf(x) ?? ''))
    expect(
      await problems(
        tenant.flatMap((r) => [outsider, fx.rivalClient].map((who) => ({ r, who }))),
        async ({ r, who }) => {
          const real = await send(who, r)
          const madeUp = await send(who, r, 'no-such-workspace')
          if (real.statusCode !== 404) return `${r.key} -> ${real.statusCode}`
          return real.body === madeUp.body && madeUp.statusCode === 404
            ? undefined
            : `${r.key} differs from a made-up workspace`
        },
      ),
    ).toEqual([])
  })
})

describe('a plain member', () => {
  it('gets 403 on every admin-only write', async () => {
    expect(
      await problems(
        routes.filter((x) => ADMIN_ONLY.has(x.key)),
        async (r) => {
          const res = await send(member, r)
          return res.statusCode === 403 ? undefined : `${r.key} -> ${res.statusCode}`
        },
      ),
    ).toEqual([])
  })

  it('is let through on the writes members may make', async () => {
    expect(
      await problems(
        routes.filter((x) => MEMBER_WRITABLE.has(x.key)),
        async (r) => {
          const res = await send(member, r)
          return refusedAccess(res) ? `${r.key} -> ${res.statusCode} ${res.body}` : undefined
        },
      ),
    ).toEqual([])
  })
})

describe('an admin', () => {
  // Deleting the workspace is for its owner; deleting the team or rotating its token would
  // change the fixture the other cases share.
  const skipped = new Set([`DELETE ${WORKSPACE}`, `DELETE ${TEAM}`, `POST ${TEAM}/token`])

  it('passes the access check on the admin-only writes', async () => {
    expect(
      await problems(
        routes.filter((x) => ADMIN_ONLY.has(x.key) && !skipped.has(x.key)),
        async (r) => {
          const res = await send(admin, r)
          return refusedAccess(res) ? `${r.key} -> ${res.statusCode} ${res.body}` : undefined
        },
      ),
    ).toEqual([])
  })

  it('cannot delete the workspace, which only an owner can', async () => {
    expect((await admin.send('DELETE', urlOf(WORKSPACE))).statusCode).toBe(403)
  })
})
