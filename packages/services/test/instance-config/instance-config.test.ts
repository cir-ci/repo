import { INSTANCE_LIMIT_DEFAULTS } from '@circi/core'
import { getInstanceDefaultRetentionDays, getSetting } from '@circi/db/queries'
import { createTestDb } from '@circi/db/testing'
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
    await expect(s.setLimits({ webhookTimeoutSeconds: 601 })).rejects.toThrow('from 1 to 600')
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
