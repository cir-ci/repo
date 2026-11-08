import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser, type Mailer } from '@circi/auth'
import { listOrgDomains } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
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
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { ...(payload === undefined ? {} : json), cookie, origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  })

async function codeSignIn(email: string): Promise<{ status: number; cookie: string }> {
  sent.length = 0
  await app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers: json,
    payload: { email, type: 'sign-in' },
  })
  await new Promise((r) => setTimeout(r, 50))
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

const base = () => `/api/organizations/${acme.orgSlug}/domains`

describe('claiming an email domain', () => {
  let domainId = ''
  let dnsValue = ''

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
    domainId = domain.id
    dnsValue = domain.dnsValue
  })

  it('rejects things that are not domains, and duplicates', async () => {
    const codes = await Promise.all(
      ['', 'ann@corp.test', 'corp', 'https://corp.test/x', 'a b.test'].map(
        async (bad) => (await call('POST', base(), ownerCookie, { domain: bad })).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400, 400, 400])
    expect((await call('POST', base(), ownerCookie, { domain: 'corp.test' })).statusCode).toBe(409)
  })

  it('does not count a claim until DNS proves it, and nobody joins meanwhile', async () => {
    expect((await call('POST', `${base()}/${domainId}/verify`, ownerCookie, {})).json()).toEqual({
      verified: false,
    })
    dns.set('_circi-verify.corp.test', [['circi-verify=wrong']])
    expect((await call('POST', `${base()}/${domainId}/verify`, ownerCookie, {})).json()).toEqual({
      verified: false,
    })
    // Ann has an account but the domain isn't verified, so signing in doesn't add her.
    const { status, cookie } = await codeSignIn('ann@corp.test')
    expect(status).toBe(200)
    const projects = await call('GET', '/api/projects', cookie)
    expect(projects.json().projects).toEqual([])
  })

  it('verifies with the right record (even split into chunks), then new sign-ins join', async () => {
    dns.set('_circi-verify.corp.test', [['unrelated'], [dnsValue.slice(0, 12), dnsValue.slice(12)]])
    expect((await call('POST', `${base()}/${domainId}/verify`, ownerCookie, {})).json()).toEqual({
      verified: true,
    })
    const list = (await call('GET', base(), ownerCookie)).json().domains
    expect(list).toEqual([expect.objectContaining({ domain: 'corp.test', verified: true })])

    const { status, cookie } = await codeSignIn('ann@corp.test')
    expect(status).toBe(200)
    const projects = (await call('GET', '/api/projects', cookie)).json().projects
    expect(projects).toHaveLength(1)
    expect(projects[0].org.slug).toBe(acme.orgSlug)
  })

  it('lets a person with no account on a verified domain create one with a code', async () => {
    const { status, cookie } = await codeSignIn('newhire@corp.test')
    expect(status).toBe(200)
    const projects = (await call('GET', '/api/projects', cookie)).json().projects
    expect(projects).toHaveLength(1)
  })

  it('gives nothing to strangers or to other domains', async () => {
    const { status } = await codeSignIn('stranger@elsewhere.test')
    expect(status).toBe(0) // no mail was sent at all
  })

  it('lets only one organization hold a verified domain', async () => {
    const other = `/api/organizations/${rival.orgSlug}/domains`
    const added = (await call('POST', other, rivalCookie, { domain: 'corp.test' })).json().domain
    dns.set('_circi-verify.corp.test', [[added.dnsValue]])
    const res = await call('POST', `${other}/${added.id}/verify`, rivalCookie, {})
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already verified/)
  })

  it('is for owners and admins of the organization only', async () => {
    expect((await call('GET', base(), rivalCookie)).statusCode).toBe(404)
    expect((await call('POST', base(), rivalCookie, { domain: 'x.test' })).statusCode).toBe(404)
    const { cookie: annCookie } = await codeSignIn('ann@corp.test')
    expect((await call('GET', base(), annCookie)).statusCode).toBe(403)
    expect((await call('DELETE', `${base()}/${domainId}`, annCookie)).statusCode).toBe(403)
  })

  it('removes a domain', async () => {
    expect((await call('DELETE', `${base()}/${domainId}`, ownerCookie)).statusCode).toBe(204)
    expect(await listOrgDomains(t.db, acme.project.orgId)).toHaveLength(0)
    expect((await call('DELETE', `${base()}/${domainId}`, ownerCookie)).statusCode).toBe(404)
  })
})
