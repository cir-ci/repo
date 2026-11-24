import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN } from '#test/support/helpers.ts'

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-nobuild-'))
const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth: createTestAuth(t.db),
    storage: new FsStorage({ path: join(dir, 'files') }),
    publicOrigin: ORIGIN,
    webDist: join(dir, 'missing'),
  },
})
await app.ready()
afterAll(async () => {
  await app.close()
  await t.close()
})

describe('web app not built', () => {
  it('serves the notice page for app routes', async () => {
    const res = await app.inject({ url: '/acme/web/builds/2' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.body).toContain('<h1>Web app not built</h1>')
    expect(res.body).toContain('<code>pnpm build</code>')
    expect(res.body).toContain('Self-hosted CirCI')
  })

  it('still answers unknown API paths with JSON', async () => {
    const res = await app.inject({ url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })
})
