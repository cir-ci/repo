import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser, type Mailer } from '@circi/auth'
import { listWorkspaceDomains } from '@circi/db/queries'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let reset: () => Promise<void>
let dir: string
let app: FastifyInstance
let acme: Tenant
let rival: Tenant
let ownerCookie: string
let rivalCookie: string
const sent: Mailer.Mail[] = []
/** What DNS currently answers, by name. */
const dns = new Map<string, string[][]>()
const json = { origin: ORIGIN, 'content-type': 'application/json' }

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-domains-'))
  const auth = createTestAuth(t.db, {
    send: async (mail: Mailer.Mail) => {
      sent.push(mail)
    },
  })
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: dir }),
      publicOrigin: ORIGIN,
      emailLogin: true,
      resolveTxt: async (name) => {
        const records = dns.get(name)
        if (!records) throw new Error('ENOTFOUND')
        return records
      },
    },
  })
  await app.ready()
  acme = await seedTenant(auth, t.db)
  rival = await seedTenant(auth, t.db)
  ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
  await createUser(auth, { email: 'ann@corp.test', name: 'Ann', password: 'ann-password-long-1' })
  reset = await snapshotDb(t)
})
beforeEach(async () => {
  await reset()
  dns.clear()
  sent.length = 0
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const call = caller(() => app)

async function codeSignIn(email: string): Promise<{ status: number; cookie: string }> {
  sent.length = 0
  await app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers: json,
    payload: { email, type: 'sign-in' },
  })
  // The code is mailed before the request is answered (better-auth awaits the plugin's hook).
  const otp = /sign-in code is (\d{6})/.exec(sent[0]?.text ?? '')?.[1]
  if (!otp) return { status: 0, cookie: '' }
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    headers: json,
    payload: { email, otp },
  })
  const cookie = [res.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ')
  return { status: res.statusCode, cookie }
}

const base = () => `/api/workspaces/${acme.workspaceSlug}/domains`

/** Claims corp.test for Acme: the id and the TXT value DNS must serve. */
async function addDomain(): Promise<{ id: string; dnsValue: string }> {
  const res = await call('POST', base(), ownerCookie, { domain: ' @Corp.Test ' })
  expect(res.statusCode).toBe(201)
  const { domain } = res.json()
  return { id: domain.id, dnsValue: domain.dnsValue }
}

/** Claims corp.test for Acme and has DNS prove it. */
async function verifiedDomain(): Promise<{ id: string; dnsValue: string }> {
  const domain = await addDomain()
  dns.set('_circi-verify.corp.test', [[domain.dnsValue]])
  const res = await call('POST', `${base()}/${domain.id}/verify`, ownerCookie, {})
  expect(res.json()).toEqual({ verified: true })
  return domain
}

describe('claiming an email domain', () => {
  it('adds a domain and says what to put in DNS', async () => {
    const res = await call('POST', base(), ownerCookie, { domain: ' @Corp.Test ' })
    expect(res.statusCode).toBe(201)
    const { domain } = res.json()
    expect(domain).toMatchObject({
      domain: 'corp.test',
      verified: false,
      dnsName: '_circi-verify.corp.test',
    })
    expect(domain.dnsValue).toMatch(/^circi-verify=/)
  })

  it('rejects things that are not domains, and duplicates', async () => {
    await addDomain()
    const codes = await Promise.all(
      ['', 'ann@corp.test', 'corp', 'https://corp.test/x', 'a b.test'].map(
        async (bad) => (await call('POST', base(), ownerCookie, { domain: bad })).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400, 400, 400])
    expect((await call('POST', base(), ownerCookie, { domain: 'corp.test' })).statusCode).toBe(409)
  })

  it('does not count a claim until DNS proves it, and nobody joins meanwhile', async () => {
    const { id } = await addDomain()
    expect((await call('POST', `${base()}/${id}/verify`, ownerCookie, {})).json()).toEqual({
      verified: false,
    })
    dns.set('_circi-verify.corp.test', [['circi-verify=wrong']])
    expect((await call('POST', `${base()}/${id}/verify`, ownerCookie, {})).json()).toEqual({
      verified: false,
    })
    // Ann has an account but the domain isn't verified, so signing in doesn't add her.
    const { status, cookie } = await codeSignIn('ann@corp.test')
    expect(status).toBe(200)
    const teams = await call('GET', '/api/teams', cookie)
    expect(teams.json().teams).toEqual([])
  })

  it('verifies with the right record (even split into chunks), then new sign-ins join', async () => {
    const { id, dnsValue } = await addDomain()
    dns.set('_circi-verify.corp.test', [['unrelated'], [dnsValue.slice(0, 12), dnsValue.slice(12)]])
    expect((await call('POST', `${base()}/${id}/verify`, ownerCookie, {})).json()).toEqual({
      verified: true,
    })
    const list = (await call('GET', base(), ownerCookie)).json().domains
    expect(list).toEqual([expect.objectContaining({ domain: 'corp.test', verified: true })])

    const { status, cookie } = await codeSignIn('ann@corp.test')
    expect(status).toBe(200)
    const teams = (await call('GET', '/api/teams', cookie)).json().teams
    expect(teams).toHaveLength(1)
    expect(teams[0].workspace.slug).toBe(acme.workspaceSlug)
  })

  it('lets a person with no account on a verified domain create one with a code', async () => {
    await verifiedDomain()
    const { status, cookie } = await codeSignIn('newhire@corp.test')
    expect(status).toBe(200)
    const teams = (await call('GET', '/api/teams', cookie)).json().teams
    expect(teams).toHaveLength(1)
  })

  it('gives nothing to strangers or to other domains', async () => {
    await verifiedDomain()
    const { status } = await codeSignIn('stranger@elsewhere.test')
    expect(status).toBe(0) // no mail was sent at all
  })

  it('lets only one workspace hold a verified domain', async () => {
    await verifiedDomain()
    const other = `/api/workspaces/${rival.workspaceSlug}/domains`
    const added = (await call('POST', other, rivalCookie, { domain: 'corp.test' })).json().domain
    dns.set('_circi-verify.corp.test', [[added.dnsValue]])
    const res = await call('POST', `${other}/${added.id}/verify`, rivalCookie, {})
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already verified/)
  })

  it('is for owners and admins of the workspace only', async () => {
    const { id } = await verifiedDomain()
    expect((await call('GET', base(), rivalCookie)).statusCode).toBe(404)
    expect((await call('POST', base(), rivalCookie, { domain: 'x.test' })).statusCode).toBe(404)
    // Ann joined Acme as a member by signing in on the verified domain.
    const { cookie: annCookie } = await codeSignIn('ann@corp.test')
    expect((await call('GET', base(), annCookie)).statusCode).toBe(403)
    expect((await call('DELETE', `${base()}/${id}`, annCookie)).statusCode).toBe(403)
  })

  it('removes a domain', async () => {
    const { id } = await addDomain()
    expect((await call('DELETE', `${base()}/${id}`, ownerCookie)).statusCode).toBe(204)
    expect(await listWorkspaceDomains(t.db, acme.team.workspaceId)).toHaveLength(0)
    expect((await call('DELETE', `${base()}/${id}`, ownerCookie)).statusCode).toBe(404)
  })
})
