import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core/node'
import { getIntegration, getWorkspaceBySlug, listIntegrations } from '@circi/db/queries'
import { listIntegrationTeams } from '@circi/db/repositories'
import { createTestDb } from '@circi/db/testing'
import {
  defineIntegration,
  IntegrationRegistry,
  IntegrationUnreachableError,
  InvalidCredentialsError,
} from '@circi/integrations'
import { FsStorage } from '@circi/storage'
import { pino } from 'pino'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const SECRET = 'a-long-instance-secret-for-tests-0123456789'

/** A token-based chat integration that is not Slack: the form, the errors and a text mapping. */
const tokenchat = defineIntegration({
  id: 'tokenchat',
  group: 'chat',
  name: 'Token chat',
  description: 'A chat connected with a token.',
  logo: 'tokenchat',
  credentials: z.object({
    site: z.string().optional().meta({ label: 'Site', placeholder: 'chat.example.com' }),
    token: z.string().min(1).meta({ label: 'Token', secret: true }),
  }),
  available: (ctx) => ctx.config.slack === undefined,
  async connect(input) {
    if (input.token === 'bad')
      throw new InvalidCredentialsError('Token chat did not accept that token')
    if (input.token === 'down') throw new IntegrationUnreachableError('Token chat did not answer')
    return {
      externalId: `acct-${input.token}`,
      displayName: `Chat ${input.token}`,
      credentials: input.token,
    }
  },
  needsAttention: () => null,
  events: ['build.rejected'],
  capabilities: { chat: { send: async () => {} } },
  mapping: { target: { label: 'Room', kind: 'text' } },
})

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-connect-'))
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
    integrations: { config: {}, registry: new IntegrationRegistry([tokenchat]) },
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
const lou = await createUser(auth, {
  email: 'lou-connect@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, t.db, { workspaceSlug: acme.workspaceSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')
const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)

const call = caller(() => app)

const base = `/api/workspaces/${acme.workspaceSlug}/integrations`

const reset = await snapshotDb(t)
beforeEach(reset)

describe('POST /workspaces/:workspace/integrations/:kind/connect', () => {
  it('is for owners and admins of the workspace only', async () => {
    const body = { token: 'abc' }
    expect((await call('POST', `${base}/tokenchat/connect`, '', body)).statusCode).toBe(401)
    expect((await call('POST', `${base}/tokenchat/connect`, rivalCookie, body)).statusCode).toBe(
      404,
    )
    expect((await call('POST', `${base}/tokenchat/connect`, louCookie, body)).statusCode).toBe(403)
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('validates the body against the definition’s credentials schema', async () => {
    const res = await call('POST', `${base}/tokenchat/connect`, ownerCookie, { site: 'x' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Token is required')
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('maps the definition’s typed errors: 400 for credentials, 502 for the provider', async () => {
    const bad = await call('POST', `${base}/tokenchat/connect`, ownerCookie, { token: 'bad' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('Token chat did not accept that token')
    const down = await call('POST', `${base}/tokenchat/connect`, ownerCookie, { token: 'down' })
    expect(down.statusCode).toBe(502)
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('stores the account with its credentials sealed, and answers 409 for the same account', async () => {
    const res = await call('POST', `${base}/tokenchat/connect`, ownerCookie, { token: 'good' })
    expect(res.statusCode).toBe(201)
    const stored = await getIntegration(t.db, workspace.id, res.json().id)
    expect(stored).toMatchObject({
      kind: 'tokenchat',
      displayName: 'Chat good',
      externalId: 'acct-good',
      createdBy: acme.owner.id,
    })
    expect(stored?.encryptedCredentials).not.toContain('good')
    expect(openSecret(SECRET, stored?.encryptedCredentials ?? '')).toBe('good')
    const again = await call('POST', `${base}/tokenchat/connect`, ownerCookie, { token: 'good' })
    expect(again.statusCode).toBe(409)
    expect(
      (await listIntegrations(t.db, workspace.id)).filter((i) => i.kind === 'tokenchat'),
    ).toHaveLength(1)
  })

  it('refuses a kind that is not registered, a definition with no install, and an unavailable one', async () => {
    expect((await call('POST', `${base}/slack/connect`, ownerCookie, {})).statusCode).toBe(404)
    expect((await call('GET', `${base}/tokenchat/install`, ownerCookie)).statusCode).toBe(400)
    const unavailable = buildServer({
      logger: pino({ level: 'silent' }),
      checks: [],
      dashboard: {
        db: t.db,
        auth,
        storage: new FsStorage({ path: dir }),
        publicOrigin: ORIGIN,
        authSecret: SECRET,
        integrations: {
          config: { slack: { clientId: 'a', clientSecret: 'b' } },
          registry: new IntegrationRegistry([tokenchat]),
        },
      },
    })
    await unavailable.ready()
    const res = await call2(unavailable, `${base}/tokenchat/connect`, { token: 'x' })
    await unavailable.close()
    expect(res.statusCode).toBe(400)
  })
})

async function call2(server: typeof app, url: string, payload: unknown) {
  return server.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', cookie: ownerCookie, origin: ORIGIN },
    payload: JSON.stringify(payload),
  })
}

/** Connects Acme to Token chat as its owner; returns the integration's id. */
async function connectTokenchat(): Promise<string> {
  const res = await call('POST', `${base}/tokenchat/connect`, ownerCookie, { token: 'good' })
  expect(res.statusCode).toBe(201)
  return res.json().id
}

describe('the catalog and the list, from the registry', () => {
  it('describes the definition for the dashboard: credentials, mapping, never code or secrets', async () => {
    await connectTokenchat()
    const res = await call('GET', base, ownerCookie)
    expect(res.statusCode).toBe(200)
    const entry = res.json().catalog.find((e: { kind: string }) => e.kind === 'tokenchat')
    expect(entry).toEqual({
      kind: 'tokenchat',
      group: 'chat',
      name: 'Token chat',
      description: 'A chat connected with a token.',
      status: 'available',
      built: true,
      connectable: true,
      logo: 'tokenchat',
      oauth: false,
      credentials: [
        {
          name: 'site',
          label: 'Site',
          placeholder: 'chat.example.com',
          secret: false,
          optional: true,
        },
        { name: 'token', label: 'Token', secret: true, optional: false },
      ],
      mapping: { targetLabel: 'Room', targetKind: 'text', fields: [] },
      links: null,
    })
    // Static entries without a definition stay, planned ones disabled.
    expect(res.json().catalog.find((e: { kind: string }) => e.kind === 'teams')).toMatchObject({
      built: false,
      connectable: false,
    })
    expect(res.json().integrations).toMatchObject([
      { kind: 'tokenchat', kindName: 'Token chat', group: 'chat' },
    ])
  })
})

describe('mapping a text target', () => {
  it('maps a team by the typed id, has no targets to list, and clears it', async () => {
    const id = await connectTokenchat()
    expect((await call('GET', `${base}/${id}/targets`, ownerCookie)).statusCode).toBe(404)
    const url = `${base}/${id}/teams/web`
    expect((await call('PUT', url, ownerCookie, {})).statusCode).toBe(400)
    expect((await call('PUT', url, ownerCookie, { ref: 'room-1' })).statusCode).toBe(204)
    expect(await listIntegrationTeams(t.db, id)).toMatchObject([
      { slug: 'web', externalRef: 'room-1', extra: {} },
    ])
    const page = (await call('GET', `${base}/${id}/teams`, louCookie)).json()
    expect(page).toMatchObject({
      canManage: false,
      configured: false,
      teams: [{ slug: 'web', mapping: { ref: 'room-1', name: null } }],
    })
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    expect(await listIntegrationTeams(t.db, id)).toEqual([])
  })
})
