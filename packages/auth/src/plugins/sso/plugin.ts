import { genericOAuth } from 'better-auth/plugins'

import type { SsoProvider } from '#plugins/sso/sso.ts'

/** The generic OpenID Connect provider is a plugin; GitHub and Google are built in. */
export function ssoPlugins(providers: SsoProvider[]) {
  const oidc = providers.find((p) => p.id === 'oidc')
  if (!oidc?.issuer) return []
  return [
    genericOAuth({
      config: [
        {
          providerId: 'oidc',
          discoveryUrl: `${oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
          clientId: oidc.clientId,
          clientSecret: oidc.clientSecret,
          scopes: ['openid', 'email', 'profile'],
          pkce: true,
        },
      ],
    }),
  ]
}

export function socialProviders(providers: SsoProvider[]) {
  const pick = (id: 'github' | 'gitlab' | 'google') => {
    const p = providers.find((x) => x.id === id)
    return p
      ? {
          clientId: p.clientId,
          clientSecret: p.clientSecret,
          ...(id === 'gitlab' && p.issuer ? { issuer: p.issuer } : {}),
        }
      : undefined
  }
  const github = pick('github')
  const gitlab = pick('gitlab')
  const google = pick('google')
  return {
    ...(github ? { github } : {}),
    ...(gitlab ? { gitlab } : {}),
    ...(google ? { google } : {}),
  }
}
