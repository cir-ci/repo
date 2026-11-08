import { describe, expect, it } from 'vitest'

import { callbackUrl, type SsoProvider } from '../../src/index.ts'
import { isSsoPath, mayCreateSsoAccount, mayLinkSsoAccount } from '../../src/sso/sso.ts'

const provider = (id: SsoProvider['id']): SsoProvider => ({
  id,
  name: id,
  clientId: 'c',
  clientSecret: 's',
  trustedForEmail: false,
})

describe('single sign-on policy', () => {
  it('builds the callback address to register at the provider', () => {
    expect(callbackUrl('https://ci.acme.io', provider('github'))).toBe(
      'https://ci.acme.io/api/auth/callback/github',
    )
    expect(callbackUrl('https://ci.acme.io', provider('oidc'))).toBe(
      'https://ci.acme.io/api/auth/callback/oidc',
    )
  })

  it('recognises the callback endpoints, and nothing else', () => {
    expect(isSsoPath('/callback/github')).toBe(true)
    expect(isSsoPath('/oauth2/callback')).toBe(false)
    expect(isSsoPath('/sign-in/email')).toBe(false)
    expect(isSsoPath(undefined)).toBe(false)
  })

  it('creates an account only for invitees, or verified-domain people from a trusted provider', () => {
    const base = { trusted: false, emailVerified: false, invited: false, onVerifiedDomain: false }
    expect(mayCreateSsoAccount(base)).toBe(false)
    expect(mayCreateSsoAccount({ ...base, invited: true })).toBe(true)
    // A domain claim only counts when the provider is trusted AND says the email is verified.
    expect(mayCreateSsoAccount({ ...base, onVerifiedDomain: true })).toBe(false)
    expect(mayCreateSsoAccount({ ...base, onVerifiedDomain: true, trusted: true })).toBe(false)
    expect(
      mayCreateSsoAccount({ ...base, onVerifiedDomain: true, trusted: true, emailVerified: true }),
    ).toBe(true)
    expect(mayCreateSsoAccount({ ...base, onVerifiedDomain: true, emailVerified: true })).toBe(
      false,
    )
  })

  it('attaches to an existing account only for trusted providers', () => {
    const old = 24 * 3600_000
    expect(mayLinkSsoAccount({ trusted: false, accountAgeMs: old })).toBe(false)
    expect(mayLinkSsoAccount({ trusted: true, accountAgeMs: old })).toBe(true)
    // The account this very login just created is not "existing".
    expect(mayLinkSsoAccount({ trusted: false, accountAgeMs: 500 })).toBe(true)
  })
})
