import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBuild } from '@circi/db'
import { linkTeamToGithub } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let linked: Tenant
let plain: Tenant
let linkedBuildId = ''
let plainBuildId = ''

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-gate-'))
  const auth = createTestAuth(t.db)
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    api: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: dir }),
      publicOrigin: ORIGIN,
      githubApp: true,
    },
  })
  await app.ready()
  linked = await seedTenant(auth, t.db)
  plain = await seedTenant(auth, t.db)
  await linkTeamToGithub(t.db, linked.team.id, { installationId: '1', repoRef: 'acme/web' })
  linkedBuildId = (await createBuild(t.db, { teamId: linked.team.id, commitSha: 'abc1234' })).id
  plainBuildId = (await createBuild(t.db, { teamId: plain.team.id, commitSha: 'abc1234' })).id
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const gateOf = async (tenant: Tenant, buildId: string, query = '') => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/builds/${buildId}/status${query}`,
    headers: { authorization: `Bearer ${tenant.token}` },
  })
  return { status: res.statusCode, gate: res.json().gate }
}

describe('who blocks the merge', () => {
  it('is the check on GitHub for a linked team, and the CI job otherwise', async () => {
    expect(await gateOf(linked, linkedBuildId)).toEqual({ status: 200, gate: 'status' })
    expect(await gateOf(plain, plainBuildId)).toEqual({ status: 200, gate: 'exit-code' })
  })

  it('can be overridden by the CLI', async () => {
    expect((await gateOf(linked, linkedBuildId, '?gate=exit-code')).gate).toBe('exit-code')
    expect((await gateOf(plain, plainBuildId, '?gate=status')).gate).toBe('status')
    expect((await gateOf(linked, linkedBuildId, '?gate=nope')).status).toBe(400)
  })
})
