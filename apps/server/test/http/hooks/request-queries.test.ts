import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
afterAll(() => fx.close())

/** How many statements one dashboard request costs, session and project access included. */
async function statementsFor(url: string, cookie = fx.acmeCookie) {
  fx.queries.reset()
  const res = await fx.get(url, cookie)
  expect(res.statusCode).toBe(200)
  return fx.queries.count()
}

const comments = () => `/api/projects/${fx.acme.workspaceSlug}/web/builds/2/comments`

describe('statements per dashboard request', () => {
  it('a project-scoped request costs 4 statements (was 8): sign-in method, project access, build, comments', async () => {
    const n = await statementsFor(comments())
    // The session cookie cache skips the session and user lookups; one statement reads the sign-in
    // method and the instance-admin flag, one the project with the role and membership, one the
    // build, then the route's own reads.
    expect(n).toBeLessThanOrEqual(4)
  })

  it('costs the same on every request of a session', async () => {
    const first = await statementsFor(comments())
    const second = await statementsFor(comments())
    expect(second).toBe(first)
  })
})
