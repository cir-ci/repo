import type { IntegrationDefinition } from '@circi/integrations'
import { type ProviderRegistry } from '@circi/integrations/git'

import type { Deps } from '#http/lib/deps.ts'

/**
 * What an integration definition's functions get, from the dashboard's dependencies; undefined
 * when the instance has no secret to seal credentials with (the routes then say so).
 */
export function integrationContext(deps: {
  authSecret?: string | undefined
  publicOrigin: string
  integrations?: Deps.IntegrationsOption | undefined
  providers?: ProviderRegistry<object> | undefined
  webhookAllowPrivate?: boolean | undefined
}): IntegrationDefinition.Context | undefined {
  if (!deps.authSecret) return undefined
  return {
    authSecret: deps.authSecret,
    publicOrigin: deps.publicOrigin,
    config: deps.integrations?.config ?? {},
    ...(deps.integrations?.fetch ? { fetch: deps.integrations.fetch } : {}),
    ...(deps.webhookAllowPrivate ? { allowPrivateAddresses: true } : {}),
    ...(deps.providers ? { gitProviders: gitProvidersOf(deps.providers) } : {}),
  }
}

/** The adapters a test swapped in, by connection kind, in the shape definitions read them. */
export function gitProvidersOf(providers: ProviderRegistry<object>): Record<string, object> {
  const stubs: Record<string, object> = {}
  for (const kind of providers.kinds()) {
    const provider = providers.get(kind)
    if (provider) stubs[kind] = provider
  }
  return stubs
}
