import type { IntegrationDefinition } from '@circi/integrations'

import type { Deps } from './deps.ts'

/**
 * What an integration definition's functions get, from the dashboard's dependencies; undefined
 * when the instance has no secret to seal credentials with (the routes then say so).
 */
export function integrationContext(
  deps: Pick<Deps.Dashboard, 'authSecret' | 'publicOrigin' | 'integrations'>,
): IntegrationDefinition.Context | undefined {
  if (!deps.authSecret) return undefined
  return {
    authSecret: deps.authSecret,
    publicOrigin: deps.publicOrigin,
    config: deps.integrations?.config ?? {},
    ...(deps.integrations?.fetch ? { fetch: deps.integrations.fetch } : {}),
  }
}
