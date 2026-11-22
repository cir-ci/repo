import { generateVapidKeys } from '@circi/core/node'
import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from '#src/index.ts'

const base = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-123',
}

const withSitesHost = (host: string, extra: Record<string, string> = {}) =>
  loadConfig({ ...base, PUBLIC_URL: 'https://ci.acme.io', STATIC_SITES_HOST: host, ...extra })

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

  it('picks the diff engine: native unless CIRCI_DIFF_ENGINE says otherwise', () => {
    expect(loadConfig(base).diffEngine).toBe('native')
    expect(loadConfig({ ...base, CIRCI_DIFF_ENGINE: '' }).diffEngine).toBe('native')
    expect(loadConfig({ ...base, CIRCI_DIFF_ENGINE: 'js' }).diffEngine).toBe('js')
    expect(loadConfig({ ...base, CIRCI_DIFF_ENGINE: 'native' }).diffEngine).toBe('native')
    expect(loadConfig({ ...base, CIRCI_DIFF_ENGINE: 'js-workers' }).diffEngine).toBe('js-workers')
    expect(() => loadConfig({ ...base, CIRCI_DIFF_ENGINE: 'rust' })).toThrow(ConfigError)
  })

  it('reads the js-workers pool size from CIRCI_DIFF_THREADS, absent by default', () => {
    expect(loadConfig(base).diffThreads).toBeUndefined()
    expect(loadConfig({ ...base, CIRCI_DIFF_THREADS: '' }).diffThreads).toBeUndefined()
    expect(loadConfig({ ...base, CIRCI_DIFF_THREADS: '3' }).diffThreads).toBe(3)
    expect(() => loadConfig({ ...base, CIRCI_DIFF_THREADS: '0' })).toThrow(ConfigError)
  })

  it('keeps the production waits unless asked: job retries 2 s up to 5 min, webhook 10 s, GitHub 15 s', () => {
    const c = loadConfig(base)
    expect(c.jobRetry).toEqual({ baseMs: 2_000, maxMs: 300_000 })
    expect(c.webhookTimeoutMs).toBe(10_000)
    const gh = loadConfig({
      ...base,
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: 'k',
      GITHUB_APP_WEBHOOK_SECRET: 's',
    })
    expect(gh.github?.timeoutMs).toBe(15_000)
  })

  it('scales the waits for tests (JOB_RETRY_*, WEBHOOK_TIMEOUT_SECONDS, GITHUB_API_TIMEOUT_SECONDS)', () => {
    const c = loadConfig({
      ...base,
      JOB_RETRY_BASE_SECONDS: '0.25',
      JOB_RETRY_MAX_SECONDS: '2',
      WEBHOOK_TIMEOUT_SECONDS: '1.5',
      GITHUB_API_TIMEOUT_SECONDS: '4',
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: 'k',
      GITHUB_APP_WEBHOOK_SECRET: 's',
    })
    expect(c.jobRetry).toEqual({ baseMs: 250, maxMs: 2_000 })
    expect(c.webhookTimeoutMs).toBe(1_500)
    expect(c.github?.timeoutMs).toBe(4_000)
    expect(() => loadConfig({ ...base, JOB_RETRY_BASE_SECONDS: '0' })).toThrow(ConfigError)
  })

  it('keeps GITHUB_API_URL for the one-click GitHub App setup, with or without an App', () => {
    expect(loadConfig(base).githubApiUrl).toBeUndefined()
    const ghe = loadConfig({ ...base, GITHUB_API_URL: 'https://ghe.example.com/api/v3/' })
    expect(ghe.githubApiUrl).toBe('https://ghe.example.com/api/v3')
    expect(ghe.github).toBeUndefined()
    expect(() => loadConfig({ ...base, GITHUB_API_URL: 'ghe.example.com' })).toThrow(ConfigError)
  })

  it('trusts no proxy by default, and parses TRUSTED_PROXIES', () => {
    expect(loadConfig(base).trustedProxies).toEqual([])
    expect(loadConfig({ ...base, TRUSTED_PROXIES: '' }).trustedProxies).toEqual([])
    expect(loadConfig({ ...base, TRUSTED_PROXIES: 'false' }).trustedProxies).toEqual([])
    expect(loadConfig({ ...base, TRUSTED_PROXIES: 'true' }).trustedProxies).toBe(true)
    expect(
      loadConfig({ ...base, TRUSTED_PROXIES: ' 10.0.0.1, 172.16.0.0/12 ,::1,fd00::/8' })
        .trustedProxies,
    ).toEqual(['10.0.0.1', '172.16.0.0/12', '::1', 'fd00::/8'])
  })

  it('rejects TRUSTED_PROXIES entries that are not addresses or CIDR ranges', () => {
    for (const bad of ['proxy.acme.io', '10.0.0.0/33', '10.0.0.1/x', '10.0.0.1,nope', '1.2.3/8']) {
      expect(() => loadConfig({ ...base, TRUSTED_PROXIES: bad })).toThrow('TRUSTED_PROXIES')
    }
  })

  it('reads the email login switch and the SMTP server separately (the dashboard can set up either later)', () => {
    expect(loadConfig(base)).toMatchObject({ emailEnabled: true })
    expect(loadConfig(base).smtp).toBeUndefined()
    const smtp = { ...base, SMTP_HOST: 'smtp.acme.io', SMTP_FROM: 'CirCI <ci@acme.io>' }
    const on = loadConfig(smtp)
    expect(on.smtp).toEqual({
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      from: 'CirCI <ci@acme.io>',
    })
    expect(loadConfig({ ...smtp, AUTH_EMAIL_ENABLED: 'false' }).emailEnabled).toBe(false)
    expect(loadConfig({ ...smtp, SMTP_PORT: '465' }).smtp?.secure).toBe(true)
  })

  it('lists the settings whose variable is set as locked, and no others', () => {
    expect(loadConfig(base).lockedSettings).toEqual([])
    const locked = loadConfig({
      ...base,
      WORKSPACE_CREATION: 'anyone',
      GC_GRACE_HOURS: '48',
      SMTP_HOST: 'smtp.acme.io',
      SMTP_FROM: 'ci@acme.io',
      AUTH_PASSWORD_ENABLED: '',
    })
    expect(locked.lockedSettings.toSorted()).toEqual(['gcGraceHours', 'smtp', 'workspaceCreation'])
  })

  it('needs SMTP_FROM, and user and password together', () => {
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.acme.io' })).toThrow('SMTP_FROM')
    expect(() =>
      loadConfig({ ...base, SMTP_HOST: 'h', SMTP_FROM: 'a@b.c', SMTP_USER: 'u' }),
    ).toThrow('SMTP_USER')
  })

  it('takes the web push keys from the environment as a matching pair, with a default contact', () => {
    expect(loadConfig(base).vapid).toBeUndefined()
    expect(loadConfig({ ...base, PUBLIC_URL: 'https://ci.acme.io' }).vapidSubject).toBe(
      'https://ci.acme.io',
    )
    const keys = generateVapidKeys()
    const c = loadConfig({
      ...base,
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:ops@acme.io',
    })
    expect(c.vapid).toEqual(keys)
    expect(c.vapidSubject).toBe('mailto:ops@acme.io')
    expect(() => loadConfig({ ...base, VAPID_PUBLIC_KEY: keys.publicKey })).toThrow('set both')
    expect(() =>
      loadConfig({
        ...base,
        VAPID_PUBLIC_KEY: generateVapidKeys().publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
      }),
    ).toThrow('matching')
    expect(() => loadConfig({ ...base, VAPID_SUBJECT: 'ops@acme.io' })).toThrow('VAPID_SUBJECT')
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

  it('has S3 timeouts, in seconds in the environment and milliseconds in the config', () => {
    const s3 = { ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }
    expect(loadConfig(s3).storage).toMatchObject({
      connectTimeoutMs: 10_000,
      requestTimeoutMs: 60_000,
    })
    expect(
      loadConfig({ ...s3, S3_CONNECT_TIMEOUT_SECONDS: '3', S3_REQUEST_TIMEOUT_SECONDS: '120' })
        .storage,
    ).toMatchObject({ connectTimeoutMs: 3000, requestTimeoutMs: 120_000 })
    expect(() => loadConfig({ ...s3, S3_CONNECT_TIMEOUT_SECONDS: '0' })).toThrow(
      /S3_CONNECT_TIMEOUT_SECONDS/,
    )
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

  it('lets only instance admins create workspaces unless told otherwise', () => {
    expect(loadConfig(base).workspaceCreation).toBe('admin')
    expect(loadConfig({ ...base, WORKSPACE_CREATION: 'anyone' }).workspaceCreation).toBe('anyone')
    expect(() => loadConfig({ ...base, WORKSPACE_CREATION: 'sometimes' })).toThrow(ConfigError)
  })

  it('refuses private webhook addresses unless allowed', () => {
    expect(loadConfig(base).webhookAllowPrivate).toBe(false)
    expect(
      loadConfig({ ...base, WEBHOOK_ALLOW_PRIVATE_ADDRESSES: 'true' }).webhookAllowPrivate,
    ).toBe(true)
  })

  describe('single sign-on', () => {
    it('is off unless a provider is configured', () => {
      expect(loadConfig(base).sso).toEqual([])
    })

    it('reads GitHub, Google and a generic provider, and only trusts what it should', () => {
      const c = loadConfig({
        ...base,
        AUTH_GITHUB_CLIENT_ID: 'gh',
        AUTH_GITHUB_CLIENT_SECRET: 'ghs',
        AUTH_GOOGLE_CLIENT_ID: 'g',
        AUTH_GOOGLE_CLIENT_SECRET: 'gs',
        AUTH_OIDC_ISSUER: 'https://sso.acme.io',
        AUTH_OIDC_CLIENT_ID: 'o',
        AUTH_OIDC_CLIENT_SECRET: 'os',
        AUTH_OIDC_NAME: 'Acme SSO',
      })
      expect(c.sso.map((p) => [p.id, p.name, p.trustedForEmail])).toEqual([
        ['github', 'GitHub', true],
        ['google', 'Google', true],
        ['oidc', 'Acme SSO', false],
      ])
      const trusted = loadConfig({
        ...base,
        AUTH_OIDC_ISSUER: 'https://sso.acme.io',
        AUTH_OIDC_CLIENT_ID: 'o',
        AUTH_OIDC_CLIENT_SECRET: 'os',
        AUTH_OIDC_TRUSTED_FOR_EMAIL: 'true',
      })
      expect(trusted.sso[0]?.trustedForEmail).toBe(true)
    })

    it('reads GitLab with an optional self-managed address, never trusted for email', () => {
      const c = loadConfig({
        ...base,
        AUTH_GITLAB_CLIENT_ID: 'gl',
        AUTH_GITLAB_CLIENT_SECRET: 'gls',
        AUTH_GITLAB_URL: 'https://git.acme.io/',
      })
      expect(c.sso).toMatchObject([
        { id: 'gitlab', name: 'GitLab', issuer: 'https://git.acme.io', trustedForEmail: false },
      ])
      expect(() => loadConfig({ ...base, AUTH_GITLAB_CLIENT_ID: 'gl' })).toThrow(ConfigError)
    })

    it('rejects half-configured providers', () => {
      expect(() => loadConfig({ ...base, AUTH_GITHUB_CLIENT_ID: 'gh' })).toThrow(ConfigError)
      expect(() =>
        loadConfig({ ...base, AUTH_OIDC_ISSUER: 'https://sso.acme.io', AUTH_OIDC_CLIENT_ID: 'o' }),
      ).toThrow(ConfigError)
      expect(() =>
        loadConfig({
          ...base,
          AUTH_OIDC_ISSUER: 'sso.acme.io',
          AUTH_OIDC_CLIENT_ID: 'o',
          AUTH_OIDC_CLIENT_SECRET: 'os',
        }),
      ).toThrow(ConfigError)
    })

    it('has a switch, and no longer refuses to start when every method is off (the dashboard refuses that on save)', () => {
      const github = { AUTH_GITHUB_CLIENT_ID: 'gh', AUTH_GITHUB_CLIENT_SECRET: 'ghs' }
      const off = loadConfig({ ...base, ...github, AUTH_SSO_ENABLED: 'false' })
      expect(off.ssoEnabled).toBe(false)
      expect(off.sso).toHaveLength(1)
      expect(loadConfig({ ...base, AUTH_PASSWORD_ENABLED: 'false' }).passwordLogin).toBe(false)
    })
  })

  describe('static sites domain', () => {
    it('is off unless set, and accepts an unrelated domain', () => {
      expect(loadConfig(base).staticSites).toBeUndefined()
      expect(withSitesHost('Example-Sites.com').staticSites).toEqual({
        host: 'example-sites.com',
        maxBytes: 200 * 1024 * 1024,
      })
      expect(
        withSitesHost('example-sites.com', { STATIC_SITES_MAX_MB: '50' }).staticSites?.maxBytes,
      ).toBe(50 * 1024 * 1024)
    })

    it.each([
      ['ci.acme.io', 'same as the dashboard'],
      ['acme.io', 'a parent of the dashboard'],
      ['sites.ci.acme.io', 'below the dashboard'],
      ['sites.acme.io', 'a sibling that shares acme.io'],
      ['https://example-sites.com', 'not a domain name'],
      ['localhost', 'no dot'],
    ])('refuses %s (%s)', (host) => {
      expect(() => withSitesHost(host)).toThrow(ConfigError)
    })
  })
})

describe('<NAME>_FILE', () => {
  const files: Record<string, string> = {
    '/run/secrets/auth': 'secret-from-a-file-that-is-long-enough\n',
    '/run/secrets/smtp': 'p"a\'s`s#$\\w\nord\n',
  }
  const readFile = (path: string) => {
    const content = files[path]
    if (content === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return content
  }

  it('reads a setting from the file it names, dropping one trailing newline', () => {
    const c = loadConfig(
      {
        DATABASE_URL: 'postgres://localhost/circi',
        BETTER_AUTH_SECRET_FILE: '/run/secrets/auth',
        SMTP_HOST: 'smtp.acme.io',
        SMTP_FROM: 'ci@acme.io',
        SMTP_USER: 'ci',
        SMTP_PASSWORD_FILE: '/run/secrets/smtp',
      },
      readFile,
    )
    expect(c.authSecret).toBe('secret-from-a-file-that-is-long-enough')
    expect(c.smtp?.auth).toEqual({ user: 'ci', password: 'p"a\'s`s#$\\w\nord' })
  })

  it("refuses both the setting and its file, and a file it can't read", () => {
    expect(() =>
      loadConfig({ ...base, BETTER_AUTH_SECRET_FILE: '/run/secrets/auth' }, readFile),
    ).toThrow('BETTER_AUTH_SECRET / BETTER_AUTH_SECRET_FILE: set one, not both')
    expect(() =>
      loadConfig({ ...base, SMTP_PASSWORD_FILE: '/run/secrets/nope' }, readFile),
    ).toThrow("SMTP_PASSWORD_FILE: couldn't read /run/secrets/nope (ENOENT)")
  })
})
