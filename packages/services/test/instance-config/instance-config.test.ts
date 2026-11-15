import { INSTANCE_LIMIT_DEFAULTS } from '@circi/core'
import { getInstanceDefaultRetentionDays, getSetting } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { createTestDb, seedAccount, seedUser } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  activeSso,
  createInstanceConfig,
  emailLoginOffered,
  type InstanceConfig,
  INSTANCE_CONFIG_TTL_MS,
} from '#src/index.ts'

const SECRET = 'instance-secret-for-tests'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.db.execute("delete from instance_settings where key like 'instance.%'")
  await t.db.execute(`delete from "user" where role = 'admin'`)
})

const baseEnv = (over: Partial<InstanceConfig.Env> = {}): InstanceConfig.Env => ({
  locked: [],
  workspaceCreation: 'admin',
  signIn: { password: true, email: true, sso: true },
  limits: { ...INSTANCE_LIMIT_DEFAULTS },
  sso: [],
  ...over,
})

function store(env: InstanceConfig.Env = baseEnv(), extra: { now?: () => number } = {}) {
  return createInstanceConfig({ db: t.db, authSecret: SECRET, env, ...extra })
}

describe('precedence', () => {
  it('uses the default, then the saved value, and the variable over both', async () => {
    const plain = store()
    expect((await plain.describe()).workspaceCreation).toEqual({
      value: 'admin',
      source: 'default',
      env: null,
    })
    await plain.setWorkspaceCreation('anyone')
    expect((await plain.describe()).workspaceCreation).toEqual({
      value: 'anyone',
      source: 'stored',
      env: null,
    })
    // The variable is set on this replica: it wins over what is saved, and says which one.
    const locked = store(baseEnv({ locked: ['workspaceCreation'], workspaceCreation: 'admin' }))
    expect((await locked.describe()).workspaceCreation).toEqual({
      value: 'admin',
      source: 'env',
      env: 'WORKSPACE_CREATION',
    })
    expect((await locked.get()).workspaceCreation).toBe('admin')
  })

  it('refuses to change a setting whose variable is set', async () => {
    const locked = store(
      baseEnv({
        locked: ['workspaceCreation', 'gcGraceHours', 'signInPassword', 'smtp', 'slack'],
      }),
    )
    await expect(locked.setWorkspaceCreation('anyone')).rejects.toThrow('WORKSPACE_CREATION')
    await expect(locked.setLimits({ gcGraceHours: 5 })).rejects.toThrow('GC_GRACE_HOURS')
    await expect(locked.setSignIn({ password: false })).rejects.toThrow('AUTH_PASSWORD_ENABLED')
    await expect(
      locked.saveSmtp({ host: 'h', port: 25, secure: false, user: '', from: 'a@b.c' }),
    ).rejects.toThrow('SMTP_HOST')
    await expect(locked.removeSlack()).rejects.toThrow('SLACK_CLIENT_ID')
    // The default retention has no variable, so it is never locked.
    await expect(locked.setLimits({ defaultProjectRetentionDays: 45 })).resolves.toBeDefined()
  })

  it('keeps providers from the environment read-only, next to the ones added', async () => {
    const env = baseEnv({
      sso: [
        {
          id: 'github',
          name: 'GitHub',
          clientId: 'env-id',
          clientSecret: 'env-secret',
          trustedForEmail: true,
        },
      ],
    })
    const s = store(env)
    await expect(
      s.saveSso({ id: 'github', clientId: 'x', clientSecret: 'y', trustedForEmail: true }),
    ).rejects.toThrow('AUTH_GITHUB_*')
    await s.saveSso({
      id: 'google',
      clientId: 'g-id',
      clientSecret: 'g-secret',
      trustedForEmail: true,
    })
    const described = await s.describe()
    expect(described.sso.map((p) => [p.id, p.source, p.env])).toEqual([
      ['github', 'env', 'AUTH_GITHUB_*'],
      ['google', 'stored', null],
    ])
    expect(JSON.stringify(described)).not.toContain('env-secret')
    expect(JSON.stringify(described)).not.toContain('g-secret')
    expect((await s.get()).sso.map((p) => p.id)).toEqual(['github', 'google'])
  })
})

describe('validation', () => {
  it('bounds every limit', async () => {
    const s = store()
    await expect(s.setLimits({ gcGraceHours: -1 })).rejects.toThrow('from 0 to')
    await expect(s.setLimits({ defaultProjectRetentionDays: 0 })).rejects.toThrow('from 1 to 3650')
    await expect(s.setLimits({ staticSitesMaxMb: 9000 })).rejects.toThrow('from 1 to 5000')
    await expect(s.setLimits({ webhookTimeoutSeconds: 601 })).rejects.toThrow('from 0.1 to 600')
    await expect(s.setLimits({ webhookTimeoutSeconds: 0.05 })).rejects.toThrow('from 0.1 to 600')
    expect(
      (await s.setLimits({ webhookTimeoutSeconds: 0.1 })).limits.webhookTimeoutSeconds.value,
    ).toBe(0.1)
    await expect(s.setLimits({ uploadTimeoutMinutes: 1.5 })).rejects.toThrow('whole number')
    const saved = await s.setLimits({
      gcGraceHours: 0,
      jobRetentionDays: 0,
      uploadTimeoutMinutes: 0,
    })
    expect(saved.limits.gcGraceHours.value).toBe(0)
  })

  it('checks the mail server fields, and a user needs a password', async () => {
    const s = store()
    const smtp = { host: 'smtp.acme.io', port: 587, secure: false, user: '', from: 'ci@acme.io' }
    await expect(s.saveSmtp({ ...smtp, host: '' })).rejects.toThrow('host')
    await expect(s.saveSmtp({ ...smtp, port: 70_000 })).rejects.toThrow('Port')
    await expect(s.saveSmtp({ ...smtp, from: 'nope' })).rejects.toThrow('address')
    await expect(s.saveSmtp({ ...smtp, user: 'mailer' })).rejects.toThrow('password')
    await expect(s.saveSmtp({ ...smtp, password: 'pw' })).rejects.toThrow('user name')
    await expect(s.saveSmtp(smtp)).resolves.toBeDefined()
  })

  it('checks provider fields', async () => {
    const s = store()
    await expect(
      s.saveSso({ id: 'oidc', clientId: 'a', clientSecret: 'b', trustedForEmail: false }),
    ).rejects.toThrow('issuer')
    await expect(
      s.saveSso({
        id: 'oidc',
        clientId: 'a',
        clientSecret: 'b',
        issuer: 'login.acme.io',
        trustedForEmail: false,
      }),
    ).rejects.toThrow('issuer')
    await expect(
      s.saveSso({ id: 'github', clientId: '', clientSecret: 'b', trustedForEmail: true }),
    ).rejects.toThrow('client ID')
    await expect(s.saveSso({ id: 'github', clientId: 'a', trustedForEmail: true })).rejects.toThrow(
      'client secret',
    )
  })
})

describe('secrets', () => {
  it('seals them at rest, never describes them, and keeps, replaces or removes them', async () => {
    const s = store()
    await s.saveSmtp({
      host: 'smtp.acme.io',
      port: 465,
      secure: true,
      user: 'mailer',
      from: 'CirCI <ci@acme.io>',
      password: 'smtp-password-1',
    })
    await s.saveSlack({ clientId: 'slack-id', clientSecret: 'slack-secret-1' })
    await s.saveSso({
      id: 'google',
      clientId: 'g-id',
      clientSecret: 'google-secret-1',
      trustedForEmail: true,
    })

    const raws = await Promise.all(
      ['instance.smtp', 'instance.slack', 'instance.sso'].map((key) => getSetting(t.db, key)),
    )
    for (const raw of raws) {
      expect(raw ?? '').not.toMatch(/smtp-password-1|slack-secret-1|google-secret-1/)
    }
    const described = await s.describe()
    expect(JSON.stringify(described)).not.toMatch(/smtp-password-1|slack-secret-1|google-secret-1/)
    expect(described.smtp).toMatchObject({ source: 'stored', user: 'mailer', passwordSaved: true })
    expect(described.slack).toMatchObject({
      source: 'stored',
      clientId: 'slack-id',
      secretSaved: true,
    })
    expect((await s.get()).smtp?.auth).toEqual({ user: 'mailer', password: 'smtp-password-1' })
    expect((await s.get()).slack?.clientSecret).toBe('slack-secret-1')

    // Leaving the secret out keeps it; a new one replaces it; null removes it.
    await s.saveSmtp({
      host: 'smtp2.acme.io',
      port: 465,
      secure: true,
      user: 'mailer',
      from: 'ci@acme.io',
    })
    expect((await s.get()).smtp).toMatchObject({
      host: 'smtp2.acme.io',
      auth: { password: 'smtp-password-1' },
    })
    await s.saveSmtp({
      host: 'smtp2.acme.io',
      port: 465,
      secure: true,
      user: 'mailer',
      from: 'ci@acme.io',
      password: 'smtp-password-2',
    })
    expect((await s.get()).smtp?.auth?.password).toBe('smtp-password-2')
    await s.saveSmtp({
      host: 'smtp2.acme.io',
      port: 465,
      secure: true,
      user: '',
      from: 'ci@acme.io',
      password: null,
    })
    expect((await s.get()).smtp?.auth).toBeUndefined()
    expect((await s.describe()).smtp.passwordSaved).toBe(false)
    await s.saveSlack({ clientId: 'slack-id-2' })
    expect((await s.get()).slack).toEqual({
      clientId: 'slack-id-2',
      clientSecret: 'slack-secret-1',
    })
    await s.removeSlack()
    expect((await s.get()).slack).toBeUndefined()
  })

  it('cannot be read with another instance secret', async () => {
    await store().saveSlack({ clientId: 'slack-id', clientSecret: 'slack-secret-1' })
    const other = createInstanceConfig({ db: t.db, authSecret: 'another-secret', env: baseEnv() })
    expect((await other.get()).slack).toBeUndefined()
  })
})

describe('the sign-in lockout', () => {
  it('refuses to leave nobody able to sign in, with the reason', async () => {
    const s = store()
    await expect(s.setSignIn({ password: false })).rejects.toThrow('Nobody could sign in')
    // Email codes work only with a mail server, single sign-on only with a provider.
    await expect(s.setSignIn({ password: false, email: true })).rejects.toThrow(
      'Nobody could sign in',
    )
    await s.saveSmtp({
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      user: '',
      from: 'ci@acme.io',
    })
    const saved = await s.setSignIn({ password: false })
    expect(saved.signIn.password.value).toBe(false)
    // And the mail server cannot then be removed from under email codes.
    await expect(s.removeSmtp()).rejects.toThrow('Nobody could sign in')
    await s.setSignIn({ password: true })
    await expect(s.removeSmtp()).resolves.toBeDefined()
  })

  it('refuses to turn off the method the admin is using, unless the save is theirs to make from another', async () => {
    const s = store()
    await s.saveSmtp({
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      user: '',
      from: 'ci@acme.io',
    })
    await expect(s.setSignIn({ password: false }, { using: 'password' })).rejects.toThrow(
      "You're signed in with password",
    )
    // Signed in with an email code, they may turn password off.
    await expect(s.setSignIn({ password: false }, { using: 'email' })).resolves.toBeDefined()
    // Removing the provider an admin signed in with is refused too.
    const withSso = store()
    await withSso.setSignIn({ password: true })
    await withSso.saveSso({ id: 'google', clientId: 'a', clientSecret: 'b', trustedForEmail: true })
    await expect(withSso.setSignIn({ sso: false }, { using: 'sso' })).rejects.toThrow(
      'single sign-on',
    )
    await expect(withSso.removeSso('google', { using: 'sso' })).rejects.toThrow('single sign-on')
    await expect(withSso.removeSso('google', { using: 'password' })).resolves.toBeDefined()
  })

  it('helps the offered methods: email needs the mail server, single sign-on needs a provider', async () => {
    const s = store()
    expect(emailLoginOffered(await s.get())).toBe(false)
    await s.saveSmtp({
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      user: '',
      from: 'ci@acme.io',
    })
    expect(emailLoginOffered(await s.get())).toBe(true)
    await s.setSignIn({ email: false })
    expect(emailLoginOffered(await s.get())).toBe(false)
    await s.saveSso({ id: 'google', clientId: 'a', clientSecret: 'b', trustedForEmail: true })
    expect(activeSso(await s.get())).toHaveLength(1)
    await s.setSignIn({ sso: false })
    expect(activeSso(await s.get())).toHaveLength(0)
  })
})

describe('read per request, without a restart', () => {
  it('another replica sees a change when its TTL runs out, and not before', async () => {
    let clock = 1_000
    const writer = store(baseEnv(), { now: () => clock })
    const reader = store(baseEnv(), { now: () => clock })
    expect((await reader.get()).limits.gcGraceHours).toBe(24)

    await writer.setLimits({ gcGraceHours: 72 })
    // The writer reads its own change at once.
    expect((await writer.get()).limits.gcGraceHours).toBe(72)
    // The other replica keeps what it read until the TTL passes.
    clock += INSTANCE_CONFIG_TTL_MS - 1
    expect((await reader.get()).limits.gcGraceHours).toBe(24)
    clock += 1
    expect((await reader.get()).limits.gcGraceHours).toBe(72)
  })

  it('tells subscribers when the settings change, here or after a read', async () => {
    let clock = 0
    const writer = store(baseEnv(), { now: () => clock })
    const reader = store(baseEnv(), { now: () => clock })
    const seen: string[] = []
    reader.subscribe((effective) => seen.push(effective.workspaceCreation))
    await reader.get()
    await writer.setWorkspaceCreation('anyone')
    expect(seen).toEqual([])
    clock += INSTANCE_CONFIG_TTL_MS
    await reader.get()
    expect(seen).toEqual(['anyone'])
  })

  it('invalidate makes the next read go to the database', async () => {
    let clock = 0
    const writer = store(baseEnv(), { now: () => clock })
    const reader = store(baseEnv(), { now: () => clock })
    await reader.get()
    await writer.setLimits({ jobRetentionDays: 3 })
    reader.invalidate()
    expect((await reader.get()).limits.jobRetentionDays).toBe(3)
  })
})

describe('default retention for new projects', () => {
  it('is read at each project creation', async () => {
    expect(await getInstanceDefaultRetentionDays(t.db, 30)).toBe(30)
    await store().setLimits({ defaultProjectRetentionDays: 90 })
    expect(await getInstanceDefaultRetentionDays(t.db, 30)).toBe(90)
  })
})

const SMTP_FIELDS = {
  host: 'smtp.acme.io',
  port: 587,
  secure: false,
  user: 'mailer',
  from: 'ci@acme.io',
}

describe('saving groups at the same time', () => {
  it('does not let one save revert another', async () => {
    // Each store is a replica that read the settings before the others' saves.
    const stores = [store(), store(), store(), store()]
    await Promise.all([
      stores[0]?.saveSlack({ clientId: 'slack-id', clientSecret: 'slack-secret' }),
      stores[1]?.saveSmtp({ ...SMTP_FIELDS, password: 'smtp-password' }),
      stores[2]?.setLimits({ gcGraceHours: 99 }),
      stores[3]?.saveSso({
        id: 'google',
        clientId: 'g',
        clientSecret: 'gs',
        trustedForEmail: true,
      }),
    ])
    const after = await store().get()
    expect(after.slack?.clientSecret).toBe('slack-secret')
    expect(after.smtp?.auth?.password).toBe('smtp-password')
    expect(after.limits.gcGraceHours).toBe(99)
    expect(after.sso.map((p) => p.id)).toEqual(['google'])
  })

  it('writes only the group that changed', async () => {
    const s = store()
    await s.saveSlack({ clientId: 'slack-id', clientSecret: 'slack-secret' })
    const before = await getSetting(t.db, 'instance.slack')
    await t.db
      .update(schema.instanceSettings)
      .set({ value: before ?? '' })
      .where(eq(schema.instanceSettings.key, 'instance.slack'))
    await s.setLimits({ gcGraceHours: 5 })
    expect(await getSetting(t.db, 'instance.slack')).toBe(before)
  })
})

const rotated = () =>
  createInstanceConfig({ db: t.db, authSecret: 'rotated-secret', env: baseEnv() })

async function saveAll() {
  const s = store()
  await s.saveSmtp({ ...SMTP_FIELDS, password: 'smtp-password' })
  await s.saveSlack({ clientId: 'slack-id', clientSecret: 'slack-secret' })
  await s.saveSso({ id: 'google', clientId: 'g', clientSecret: 'gs', trustedForEmail: true })
  await s.saveSso({ id: 'github', clientId: 'h', clientSecret: 'hs', trustedForEmail: true })
}

async function admin(input: { password?: boolean; provider?: string }) {
  const u = await seedUser(t.db)
  await t.db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, u.id))
  if (input.password) {
    await seedAccount(t.db, { userId: u.id, accountId: u.id, providerId: 'credential' })
    await t.db
      .update(schema.account)
      .set({ password: 'hash' })
      .where(eq(schema.account.userId, u.id))
  }
  if (input.provider) {
    await seedAccount(t.db, { userId: u.id, accountId: u.id, providerId: input.provider })
  }
  return u
}

describe('a secret that can no longer be opened', () => {
  it('is described as saved but unreadable, and not used', async () => {
    await saveAll()
    const other = rotated()
    const described = await other.describe()
    const notice = "Saved, but can't be read with the current secret: replace it"
    expect(described.smtp).toMatchObject({ host: 'smtp.acme.io', unreadable: notice })
    expect(described.slack).toMatchObject({ clientId: 'slack-id', unreadable: notice })
    expect(described.sso.map((p) => [p.id, p.unreadable])).toEqual([
      ['google', notice],
      ['github', notice],
    ])
    const effective = await other.get()
    expect(effective.smtp).toBeUndefined()
    expect(effective.slack).toBeUndefined()
    expect(effective.sso).toEqual([])
  })

  it('is left alone by a save of any other group', async () => {
    await saveAll()
    const keys = ['instance.smtp', 'instance.slack', 'instance.sso']
    const before = await Promise.all(keys.map((k) => getSetting(t.db, k)))
    const other = rotated()
    await other.setLimits({ gcGraceHours: 7 })
    await other.setWorkspaceCreation('anyone')
    await other.setSignIn({ email: false })
    expect(await Promise.all(keys.map((k) => getSetting(t.db, k)))).toEqual(before)
    // And the original secret still opens all of it.
    const original = await store().get()
    expect(original.smtp?.auth?.password).toBe('smtp-password')
    expect(original.slack?.clientSecret).toBe('slack-secret')
    expect(original.sso.map((p) => p.clientSecret)).toEqual(['gs', 'hs'])
  })

  it("keeps another provider's sealed secret as it was when one provider is replaced", async () => {
    await saveAll()
    const other = rotated()
    await other.saveSso({
      id: 'google',
      clientId: 'g2',
      clientSecret: 'new',
      trustedForEmail: true,
    })
    const described = await other.describe()
    expect(described.sso.find((p) => p.id === 'google')?.unreadable).toBeNull()
    expect(described.sso.find((p) => p.id === 'github')?.unreadable).not.toBeNull()
    // The original secret still opens github's, untouched.
    expect((await store().get()).sso.find((p) => p.id === 'github')?.clientSecret).toBe('hs')
  })

  it('asks for the password again instead of saving mail without it', async () => {
    await saveAll()
    const other = rotated()
    await expect(other.saveSmtp({ ...SMTP_FIELDS, host: 'smtp2.acme.io' })).rejects.toThrow(
      'Enter the password',
    )
    await other.saveSmtp({ ...SMTP_FIELDS, host: 'smtp2.acme.io', password: 'fresh' })
    expect((await other.get()).smtp?.auth?.password).toBe('fresh')
    expect((await other.describe()).smtp.unreadable).toBeNull()
    await expect(rotated().saveSlack({ clientId: 'slack-id' })).rejects.toThrow(
      'Enter the client secret',
    )
  })
})

describe('the sign-in lockout counts admins who can sign in', () => {
  it("refuses to turn off password sign-in when no admin has an account on what's left", async () => {
    const s = store()
    await admin({ password: true })
    await s.saveSso({ id: 'google', clientId: 'a', clientSecret: 'b', trustedForEmail: true })
    // A provider is configured, so the methods count, but no admin is linked to it.
    await expect(s.setSignIn({ password: false })).rejects.toThrow(
      'No instance admin could sign in',
    )
    expect((await s.get()).signIn.password).toBe(true)
  })

  it('allows it once an admin is linked to an enabled provider', async () => {
    const s = store()
    await admin({ password: true })
    await admin({ provider: 'google' })
    await s.saveSso({ id: 'google', clientId: 'a', clientSecret: 'b', trustedForEmail: true })
    await expect(s.setSignIn({ password: false })).resolves.toBeDefined()
    // Removing that provider would leave nobody.
    await expect(s.removeSso('google')).rejects.toThrow('Nobody could sign in')
  })

  it('refuses to remove the provider the only admin is linked to', async () => {
    const s = store()
    await admin({ provider: 'github' })
    await s.saveSso({ id: 'github', clientId: 'a', clientSecret: 'b', trustedForEmail: true })
    await s.saveSso({ id: 'google', clientId: 'a', clientSecret: 'b', trustedForEmail: true })
    await s.setSignIn({ password: false })
    await expect(s.removeSso('github')).rejects.toThrow('No instance admin could sign in')
    await expect(s.removeSso('google')).resolves.toBeDefined()
  })

  it('counts email codes as a way in for every admin', async () => {
    const s = store()
    await admin({ password: true })
    await s.saveSmtp({ ...SMTP_FIELDS, user: '' })
    await expect(s.setSignIn({ password: false })).resolves.toBeDefined()
  })
})
