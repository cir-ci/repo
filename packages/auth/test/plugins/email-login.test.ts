import { schema } from '@circi/db'
import { createTestDb, seedOrg, seedUser } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Auth, createAuth, type Mailer } from '#src/index.ts'

let t: createTestDb.Result
let auth: Auth
const sent: Mailer.Mail[] = []
const mailErrors: unknown[] = []

beforeAll(async () => {
  t = await createTestDb()
  auth = createAuth({
    db: t.db,
    secret: 'test-secret-that-is-long-enough-1234',
    baseURL: 'http://localhost:3000',
    mailer: {
      send: (mail) => {
        sent.push(mail)
        return Promise.resolve()
      },
    },
    onMailError: (err) => mailErrors.push(err),
  })
})
afterAll(async () => {
  await t.close()
})

const requestCode = (email: string) =>
  auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

describe('email login plugin', () => {
  it('mails a code, with a link carrying it, to an address that has an account', async () => {
    const user = await seedUser(t.db, 'known@acme.test')
    await requestCode(user.email)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('known@acme.test')
    expect(sent[0]?.text).toMatch(/#signin-email=known%40acme\.test&code=\d{6}/)
  })

  it('answers the same for an unknown address but sends nothing', async () => {
    const before = sent.length
    await expect(requestCode('stranger@nowhere.test')).resolves.toEqual({ success: true })
    expect(sent).toHaveLength(before)
  })

  it('mails an invited address', async () => {
    const { org, owner } = await seedOrg(t.db)
    await t.db.insert(schema.invitation).values({
      id: 'inv-login',
      organizationId: org.id,
      email: 'invited@acme.test',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600_000),
      inviterId: owner.id,
    })
    const before = sent.length
    await requestCode('invited@acme.test')
    expect(sent).toHaveLength(before + 1)
  })

  it('mails an address on a verified organization domain', async () => {
    const { org } = await seedOrg(t.db)
    await t.db.insert(schema.orgDomains).values({
      orgId: org.id,
      domain: 'corp.test',
      verificationToken: 't',
      verifiedAt: new Date(),
    })
    const before = sent.length
    await requestCode('new@corp.test')
    expect(sent).toHaveLength(before + 1)
  })
})
