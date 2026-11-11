import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN } from '#test/support/helpers.ts'

/**
 * The URL-stability proof for the layering refactor (docs/architecture-review/layering.md §5): the
 * full route table, every scope registered, as a sorted list of `METHOD url`. Moving a route file,
 * a handler or a service must not change it; a route added or removed on purpose updates the
 * snapshot (`pnpm vitest run -u apps/server/test/http/route-table.test.ts`) in the same commit.
 */

/** Flattens Fastify's printed radix tree: each line continues its parent's path and lists methods. */
export function routeList(tree: string): string[] {
  const stack: string[] = []
  const routes: string[] = []
  for (const line of tree.split('\n')) {
    const m = /^((?:│ {3}| {4})*)[├└]── (.*?) \(([^)]*)\)$/.exec(line)
    if (!m) continue
    const depth = (m[1] ?? '').length / 4
    const path = (stack[depth - 1] ?? '') + (m[2] ?? '')
    stack[depth] = path
    stack.length = depth + 1
    for (const method of (m[3] ?? '').split(', ')) routes.push(`${method} ${path}`)
  }
  return routes.toSorted()
}

let close: () => Promise<void>
let tree: string

beforeAll(async () => {
  const t = await createTestDb()
  const dir = await mkdtemp(join(tmpdir(), 'circi-routes-'))
  const storage = new FsStorage({ path: join(dir, 'files') })
  const auth = createTestAuth(t.db)
  const base = { db: t.db, auth, storage, publicOrigin: ORIGIN }
  const app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    api: base,
    tlsAsk: { db: t.db },
    gitWebhook: {
      db: t.db,
      authSecret: 'route-table-secret-long-enough-1',
      publicOrigin: ORIGIN,
      logger: pino({ level: 'silent' }),
    },
    dashboard: base,
  })
  await app.ready()
  tree = app.printRoutes({ commonPrefix: false })
  close = async () => {
    await app.close()
    await t.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60_000)
afterAll(() => close())

describe('the route table', () => {
  it('lists every scope: health, /v1, /v2, webhooks, dashboard API', () => {
    const routes = routeList(tree)
    for (const prefix of [
      '/healthz',
      '/v1/',
      '/v2/',
      '/webhooks/',
      '/api/projects/',
      '/api/workspaces/',
    ]) {
      expect(routes.some((r) => r.split(' ')[1]?.startsWith(prefix))).toBe(true)
    }
  })

  it('has not changed (method and url, sorted)', () => {
    expect(routeList(tree).join('\n')).toMatchSnapshot()
  })
})
