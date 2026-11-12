import { socialProviders as builtInProviders } from '@better-auth/core/social-providers'
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

const SSO_IDS = new Set(['github', 'gitlab', 'google', 'oidc'])

/** The part of better-auth's context `reloadSso` edits. */
interface SsoContext {
  socialProviders: { id: string }[]
}

/**
 * Replaces the single sign-on providers of a running better-auth. Its provider list is built at
 * start, so the list in its context is edited in place (every request sees it); `live` is the
 * array the hooks read for their trust decisions. The generic OpenID Connect provider is built
 * by running its plugin's own `init` on a copy of the context, which fetches the issuer's
 * discovery document: if that fails the provider is left out. Returns the ids that were set up.
 */
export async function reloadSso(
  auth: { $context: Promise<SsoContext> },
  live: SsoProvider[],
  providers: SsoProvider[],
): Promise<string[]> {
  const ctx = await auth.$context
  const social = socialProviders(providers)
  const built = Object.entries(social).flatMap(([id, config]) => {
    const make =
      id === 'github' || id === 'gitlab' || id === 'google' ? builtInProviders[id] : undefined
    return make ? [make(config)] : []
  })
  const oidc = ssoPlugins(providers)[0]
  const generic = oidc ? await oidcProviders(oidc, ctx) : []
  live.splice(0, live.length, ...providers)
  const kept = ctx.socialProviders.filter((p) => !SSO_IDS.has(p.id))
  ctx.socialProviders.splice(0, ctx.socialProviders.length, ...generic, ...built, ...kept)
  return [...generic, ...built].map((p) => p.id)
}

/** The generic provider's plugin builds its providers in `init`, from a context of which it uses the logger. */
async function oidcProviders(
  plugin: ReturnType<typeof genericOAuth>,
  ctx: SsoContext,
): Promise<SsoContext['socialProviders']> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const copy = { ...ctx, socialProviders: [] } as unknown as Parameters<typeof plugin.init>[0]
  return (await plugin.init(copy))?.context?.socialProviders ?? []
}
