import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from '../src/index.ts'

const base = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-123',
}

describe('loadConfig', () => {
  it('applies defaults (local-disk storage)', () => {
    const c = loadConfig(base)
    expect(c.storage).toEqual({ driver: 'fs', path: '/var/lib/circi/files' })
    expect(c.http).toEqual({ host: '0.0.0.0', port: 3000 })
    expect(c.publicUrl.origin).toBe('http://localhost:3000')
    expect(c.previousPublicHosts).toEqual([])
    expect(c.warnings).toEqual([])
    expect(c.env).toBe('production')
  })

  it('offers email login only with SMTP, and lets it be switched off', () => {
    expect(loadConfig(base)).toMatchObject({ emailLogin: false })
    const smtp = { ...base, SMTP_HOST: 'smtp.acme.io', SMTP_FROM: 'CirCI <ci@acme.io>' }
    const on = loadConfig(smtp)
    expect(on.emailLogin).toBe(true)
    expect(on.smtp).toEqual({
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      from: 'CirCI <ci@acme.io>',
    })
    expect(loadConfig({ ...smtp, AUTH_EMAIL_ENABLED: 'false' }).emailLogin).toBe(false)
    expect(loadConfig({ ...smtp, SMTP_PORT: '465' }).smtp?.secure).toBe(true)
  })

  it('warns when email login is asked for without SMTP', () => {
    const c = loadConfig({ ...base, AUTH_EMAIL_ENABLED: 'true' })
    expect(c.emailLogin).toBe(false)
    expect(c.warnings.join()).toContain('SMTP_HOST')
  })

  it('needs SMTP_FROM, and user and password together', () => {
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.acme.io' })).toThrow('SMTP_FROM')
    expect(() =>
      loadConfig({ ...base, SMTP_HOST: 'h', SMTP_FROM: 'a@b.c', SMTP_USER: 'u' }),
    ).toThrow('SMTP_USER')
  })

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
  })

  it('requires S3_BUCKET for the s3 driver', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(
      expect.objectContaining({ issues: [expect.stringContaining('S3_BUCKET')] }),
    )
  })

  it('rejects half-set S3 credentials', () => {
    expect(() =>
      loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'x' }),
    ).toThrow(/set both/)
  })

  it('uses path-style addressing by default when an endpoint is set (MinIO, R2)', () => {
    const c = loadConfig({
      ...base,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'circi',
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
    })
    expect(c.storage).toMatchObject({
      driver: 's3',
      bucket: 'circi',
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    })
  })

  it('omits credentials so the AWS chain (IAM role) is used', () => {
    const c = loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: '' })
    expect(c.storage).not.toHaveProperty('credentials')
    expect(c.storage).toMatchObject({ forcePathStyle: false })
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow(ConfigError)
  })

  describe('dashboard address (PUBLIC_URL)', () => {
    it.each([
      ['https://circi.example.com', 'https://circi.example.com', 'circi.example.com'],
      ['https://ci.acme.io/', 'https://ci.acme.io', 'ci.acme.io'],
      ['https://Visual.ACME.dev:8443', 'https://visual.acme.dev:8443', 'visual.acme.dev:8443'],
      ['http://localhost:4000', 'http://localhost:4000', 'localhost:4000'],
    ])('accepts any host: %s', (raw, origin, host) => {
      const c = loadConfig({ ...base, PUBLIC_URL: raw })
      expect(c.publicUrl).toMatchObject({ origin, host })
    })

    it.each([
      ['https://example.com/circi', /without a path/],
      ['https://ci.acme.io/?x=1', /query string/],
      ['ftp://ci.acme.io', /https:\/\/ or http:\/\//],
      ['https://user:pw@ci.acme.io', /username or password/],
      ['ci.acme.io', /not a URL/],
    ])('rejects %s', (raw, message) => {
      expect(() => loadConfig({ ...base, PUBLIC_URL: raw })).toThrow(message)
    })

    it('warns about plain http on a non-local host, but not on localhost', () => {
      expect(loadConfig({ ...base, PUBLIC_URL: 'http://ci.acme.io' }).warnings).toEqual([
        expect.stringContaining('plain http on ci.acme.io'),
      ])
      expect(loadConfig({ ...base, PUBLIC_URL: 'http://app.localhost:3000' }).warnings).toEqual([])
    })

    it('collects previous addresses for redirects, deduplicated', () => {
      const c = loadConfig({
        ...base,
        PUBLIC_URL: 'https://ci.acme.io',
        PREVIOUS_PUBLIC_URLS:
          'https://circi.acme.io, https://CIRCI.acme.io/,https://old.acme.io:8443',
      })
      expect(c.previousPublicHosts).toEqual(['circi.acme.io', 'old.acme.io:8443'])
    })

    it('rejects a previous address equal to the current one', () => {
      expect(() =>
        loadConfig({
          ...base,
          PUBLIC_URL: 'https://ci.acme.io',
          PREVIOUS_PUBLIC_URLS: 'https://ci.acme.io',
        }),
      ).toThrow(/is the current PUBLIC_URL host/)
    })
  })
})

describe('BETTER_AUTH_SECRET', () => {
  it('is required, and says how to make one', () => {
    const { BETTER_AUTH_SECRET: _omit, ...withoutSecret } = base
    expect(() => loadConfig(withoutSecret)).toThrow(/openssl rand -base64 32/)
  })

  it('must be at least 32 characters', () => {
    expect(() => loadConfig({ ...base, BETTER_AUTH_SECRET: 'too-short' })).toThrow(/at least 32/)
    expect(loadConfig({ ...base, BETTER_AUTH_SECRET: 'x'.repeat(32) }).authSecret).toBe(
      'x'.repeat(32),
    )
  })

  it('lets only instance admins create organizations unless told otherwise', () => {
    expect(loadConfig(base).orgCreation).toBe('admin')
    expect(loadConfig({ ...base, ORG_CREATION: 'anyone' }).orgCreation).toBe('anyone')
    expect(() => loadConfig({ ...base, ORG_CREATION: 'sometimes' })).toThrow(ConfigError)
  })

  it('refuses private webhook addresses unless allowed', () => {
    expect(loadConfig(base).webhookAllowPrivate).toBe(false)
    expect(
      loadConfig({ ...base, WEBHOOK_ALLOW_PRIVATE_ADDRESSES: 'true' }).webhookAllowPrivate,
    ).toBe(true)
  })
})
