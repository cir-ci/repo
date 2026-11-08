import { describe, expect, it } from 'vitest'

import { socialProviders, ssoPlugins } from '#plugins/sso.ts'
import type { SsoProvider } from '#sso/sso.ts'

const provider = (id: SsoProvider['id'], issuer?: string): SsoProvider => ({
  id,
  name: id,
  clientId: `${id}-id`,
  clientSecret: `${id}-secret`,
  trustedForEmail: false,
  ...(issuer ? { issuer } : {}),
})

describe('ssoPlugins', () => {
  it('adds nothing without a generic OpenID Connect provider with an issuer', () => {
    expect(ssoPlugins([])).toEqual([])
    expect(ssoPlugins([provider('github')])).toEqual([])
    expect(ssoPlugins([provider('oidc')])).toEqual([])
  })

  it('adds the generic OAuth plugin for one with an issuer', () => {
    const plugins = ssoPlugins([provider('oidc', 'https://idp.test/')])
    expect(plugins.map((p) => p.id)).toEqual(['generic-oauth'])
  })
})

describe('socialProviders', () => {
  it('passes only the built-in providers that were configured', () => {
    expect(socialProviders([provider('github'), provider('oidc', 'https://idp.test')])).toEqual({
      github: { clientId: 'github-id', clientSecret: 'github-secret' },
    })
    expect(socialProviders([provider('google')])).toEqual({
      google: { clientId: 'google-id', clientSecret: 'google-secret' },
    })
    expect(socialProviders([])).toEqual({})
  })
})
