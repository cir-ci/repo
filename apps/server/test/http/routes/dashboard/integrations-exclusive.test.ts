import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getWorkspaceBySlug, listIntegrationTeams, listIntegrations } from '@circi/db'
import {
  defineIntegration,
  type IntegrationDefinition,
  IntegrationRegistry,
} from '@circi/integrations'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { pino } from 'pino'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

/**
 * The `exclusive` flag: one external account connects in ONE workspace of the instance, and a
 * team maps to one connection of the kind (mapping to a second moves it). `replaceOnReconnect`
 * turns a second connect of the same account in the same workspace into a replacement.
 */

const SECRET = 'a-long-instance-secret-for-tests-0123456789'

const make = (
  id: string,
  options: { exclusive?: IntegrationDefinition.Exclusive; replaceOnReconnect?: true } = {},
) =>
  defineIntegration({
    id,
    group: 'tracker',
    name: id,
    description: 'Exclusive tests.',
    logo: id,
    credentials: z.object({ token: z.string().min(1).meta({ label: 'Token', secret: true }) }),
    async connect(input) {
      return {
        externalId: `acct-${input.token}`,
        displayName: input.token,
        credentials: input.token,
      }
    },
    needsAttention: () => null,
    events: ['build.rejected'],
    capabilities: { chat: { send: async () => {} } },
    mapping: { target: { label: 'Room', kind: 'text' } },
    ...options,
  })

const exclusive = make('exclusive', { exclusive: { account: true, team: 'kind' } })
const replacing = make('replacing', { replaceOnReconnect: true })
const plain = make('plain')

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-exclusive-'))
const auth = createTestAuth(t.db)
const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: SECRET,
    integrations: { config: {}, registry: new IntegrationRegistry([exclusive, replacing, plain]) },
  },
})
await app.ready()
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const acme = await seedTenant(auth, t.db)
const rival = await seedTenant(auth, t.db)
const ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)

const call = caller(() => app)

const base = (slug: string) => `/api/workspaces/${slug}/integrations`
const connect = (slug: string, cookie: string, kind: string, token: string) =>
  call('POST', `${base(slug)}/${kind}/connect`, cookie, { token })

const reset = await snapshotDb(t)
beforeEach(reset)

describe('exclusive.account', () => {
  it('refuses an account another workspace already connected (409), but not its own again', async () => {
    expect((await connect(acme.workspaceSlug, ownerCookie, 'exclusive', 'one')).statusCode).toBe(
      201,
    )
    const taken = await connect(rival.workspaceSlug, rivalCookie, 'exclusive', 'one')
    expect(taken.statusCode).toBe(409)
    expect(taken.json().error).toMatch(/another workspace/)
    expect(
      await listIntegrations(t.db, (await getWorkspaceBySlug(t.db, rival.workspaceSlug)).id),
    ).toEqual([])
    // The same workspace connecting it again is the ordinary duplicate.
    expect((await connect(acme.workspaceSlug, ownerCookie, 'exclusive', 'one')).statusCode).toBe(
      409,
    )
    // Another account is fine, and so is the same account of a kind without the flag.
    expect((await connect(rival.workspaceSlug, rivalCookie, 'exclusive', 'two')).statusCode).toBe(
      201,
    )
    expect((await connect(acme.workspaceSlug, ownerCookie, 'plain', 'one')).statusCode).toBe(201)
    expect((await connect(rival.workspaceSlug, rivalCookie, 'plain', 'one')).statusCode).toBe(201)
  })
})

describe('replaceOnReconnect', () => {
  it('keeps one integration when the same account connects again', async () => {
    const first = await connect(acme.workspaceSlug, ownerCookie, 'replacing', 'same')
    const second = await connect(acme.workspaceSlug, ownerCookie, 'replacing', 'same')
    expect(first.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)
    expect(
      (await listIntegrations(t.db, workspace.id)).filter((i) => i.kind === 'replacing'),
    ).toHaveLength(1)
  })
})

describe('exclusive.team', () => {
  it('moves a team to the second connection of the kind, and only within the kind', async () => {
    expect((await connect(acme.workspaceSlug, ownerCookie, 'exclusive', 'one')).statusCode).toBe(
      201,
    )
    expect((await connect(acme.workspaceSlug, ownerCookie, 'plain', 'one')).statusCode).toBe(201)
    const two = await connect(acme.workspaceSlug, ownerCookie, 'exclusive', 'second-account')
    const all = await listIntegrations(t.db, workspace.id)
    const first = all.find((i) => i.kind === 'exclusive' && i.displayName === 'one')
    const plainOne = all.find((i) => i.kind === 'plain')
    const put = (id: string | undefined) =>
      call('PUT', `${base(acme.workspaceSlug)}/${id}/teams/web`, ownerCookie, { ref: 'room-1' })
    expect((await put(first?.id)).statusCode).toBe(204)
    expect((await put(plainOne?.id)).statusCode).toBe(204)
    expect((await put(two.json().id)).statusCode).toBe(204)
    expect(await listIntegrationTeams(t.db, first?.id ?? '')).toEqual([])
    expect(await listIntegrationTeams(t.db, two.json().id)).toHaveLength(1)
    // A kind without the flag keeps its own mapping, and may be mapped twice.
    expect(await listIntegrationTeams(t.db, plainOne?.id ?? '')).toHaveLength(1)
  })
})
