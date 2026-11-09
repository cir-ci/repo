import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Workspace } from '@circi/api'
import { addMember, createUser } from '@circi/auth'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { imageBytes } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let slug: string
let ownerCookie: string
let adminCookie: string
let memberCookie: string
let outsiderCookie: string

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-picture-route-'))
  const auth = createTestAuth(t.db)
  const deps = { db: t.db, auth, storage: new FsStorage({ path: dir }), publicOrigin: ORIGIN }
  app = buildServer({ logger: pino({ level: 'silent' }), checks: [], dashboard: deps, api: deps })
  await app.ready()
  const tenant = await seedTenant(auth, t.db)
  slug = tenant.workspaceSlug
  ownerCookie = await signIn(app, tenant.owner.email, tenant.owner.password)
  const make = async (name: string, role?: 'admin' | 'member') => {
    const email = `${name}-${slug}@acme.test`
    const password = `password-for-${name}-long-1`
    await createUser(auth, { email, name, password })
    if (role) await addMember(auth, t.db, { workspaceSlug: slug, email, role })
    return signIn(app, email, password)
  }
  adminCookie = await make('admin', 'admin')
  memberCookie = await make('member', 'member')
  outsiderCookie = await make('outsider')
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const call = caller(() => app)
const url = () => `/api/workspaces/${slug}/picture`

const upload = (cookie: string, body: Buffer | string, type: string) =>
  app.inject({
    method: 'PUT',
    url: url(),
    headers: { origin: ORIGIN, 'content-type': type, cookie },
    payload: body,
  })

describe('workspace picture', () => {
  it('has none at first: the page says so and the picture is a 404', async () => {
    const general = await call('GET', `/api/workspaces/${slug}`, memberCookie)
    expect(general.json<Workspace.General>().picture).toBeNull()
    expect((await call('GET', url(), memberCookie)).statusCode).toBe(404)
  })

  it('lets an owner upload a JPEG, resizes it and serves it to members with cache headers', async () => {
    const res = await upload(
      ownerCookie,
      await imageBytes({ format: 'jpeg', width: 500, height: 300 }),
      'image/jpeg',
    )
    expect(res.statusCode).toBe(200)
    const { picture } = res.json<Workspace.Picture>()
    expect(picture).toMatch(new RegExp(`^/api/workspaces/${slug}/picture\\?v=[0-9a-f]{12}$`))

    // The workspace page, the capabilities and the teams overview all carry the address.
    expect(
      (await call('GET', `/api/workspaces/${slug}`, memberCookie)).json<Workspace.General>()
        .picture,
    ).toBe(picture)

    const served = await call('GET', picture ?? '', memberCookie)
    expect(served.statusCode).toBe(200)
    expect(served.headers['content-type']).toBe('image/png')
    expect(served.headers['cache-control']).toContain('immutable')
    expect(served.rawPayload.subarray(1, 4).toString()).toBe('PNG')

    const etag = String(served.headers.etag)
    const again = await app.inject({
      method: 'GET',
      url: url(),
      headers: { cookie: memberCookie, 'if-none-match': etag },
    })
    expect(again.statusCode).toBe(304)
    // Without the version in the address, a browser must ask again.
    const plain = await call('GET', url(), memberCookie)
    expect(plain.headers['cache-control']).toContain('must-revalidate')
  })

  it('does not show it to people outside the workspace or signed out', async () => {
    expect((await call('GET', url(), outsiderCookie)).statusCode).toBe(404)
    expect((await call('GET', url(), '')).statusCode).toBe(401)
  })

  it('lets an admin replace it, but not a plain member', async () => {
    const png = await imageBytes({ format: 'png', width: 64, height: 64, color: '#00ff00' })
    expect((await upload(memberCookie, png, 'image/png')).statusCode).toBe(403)
    expect((await upload(outsiderCookie, png, 'image/png')).statusCode).toBe(404)
    const ok = await upload(
      adminCookie,
      await imageBytes({ format: 'webp', color: '#00ff00' }),
      'image/webp',
    )
    expect(ok.statusCode).toBe(200)
  })

  it('refuses other types, bad bytes and anything over 1 MB with a clear 400', async () => {
    const gif = await imageBytes({ format: 'gif' })
    for (const [body, type] of [
      [gif, 'image/gif'],
      [gif, 'image/png'],
      ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
      ['not an image', 'image/png'],
      ['{}', 'application/json'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- one refused upload after another
      const res = await upload(ownerCookie, body, type)
      expect([type, res.statusCode]).toEqual([type, 400])
      expect(res.json<{ error: string }>().error).toBeTruthy()
    }
    const big = await upload(ownerCookie, Buffer.alloc(1024 * 1024 + 1), 'image/png')
    expect(big.statusCode).toBe(400)
    expect(big.json<{ error: string }>().error).toContain('1 MB')
  })

  it('removes it (owners and admins only); the first letter shows again', async () => {
    expect((await call('DELETE', url(), memberCookie)).statusCode).toBe(403)
    const res = await call('DELETE', url(), ownerCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json<Workspace.Picture>().picture).toBeNull()
    expect((await call('GET', url(), memberCookie)).statusCode).toBe(404)
  })
})
