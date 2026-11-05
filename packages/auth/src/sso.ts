/**
 * Single sign-on (PLAN §7.8): GitHub, Google and one generic OpenID Connect provider, set up
 * by whoever runs the server (instance-scoped). Identities are matched by (provider, subject)
 * as better-auth stores them; what's added here is when such a login may *create an account*
 * or *attach to an existing one*, because a provider's say-so about an email address is only
 * worth what the operator trusts it for.
 */

export interface SsoProvider {
  /** `github`, `google` or `oidc` (better-auth's provider id; also part of the callback URL). */
  id: 'github' | 'google' | 'oidc'
  /** Label on the sign-in button. */
  name: string
  clientId: string
  clientSecret: string
  /** Issuer of the generic OpenID Connect provider (`oidc` only). */
  issuer?: string
  /**
   * The operator vouches that this provider only reports addresses its users own. Only then may
   * a login attach to an existing account with the same email, or count towards a verified
   * email domain.
   */
  trustedForEmail: boolean
}

/** Every provider, the generic one included, comes back to better-auth's `callback/:id`. */
export const callbackUrl = (origin: string, provider: Pick<SsoProvider, 'id'>) =>
  `${origin}/api/auth/callback/${provider.id}`

export const isSsoPath = (path: string | undefined): boolean =>
  path !== undefined && path.startsWith('/callback/')

/**
 * May a single sign-on login create a brand new account? Not just because the provider knows
 * the person: only if they were invited, or the provider is trusted for email and the address
 * is on a domain an organization has verified.
 */
export function mayCreateSsoAccount(input: {
  trusted: boolean
  emailVerified: boolean
  invited: boolean
  onVerifiedDomain: boolean
}): boolean {
  return input.invited || (input.trusted && input.emailVerified && input.onVerifiedDomain)
}

/**
 * May a login with this provider be attached to an account that already existed? Only for
 * providers the operator trusts for email. (Accounts created moments ago, by this very login,
 * aren't "existing".)
 */
export function mayLinkSsoAccount(input: { trusted: boolean; accountAgeMs: number }): boolean {
  return input.trusted || input.accountAgeMs < 60_000
}
