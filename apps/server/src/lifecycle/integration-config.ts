import type { Config } from '@circi/config'
import type { IntegrationDefinition } from '@circi/integrations'

/**
 * The instance settings the integration definitions read (`IntegrationDefinition.InstanceConfig`),
 * from the configuration: one key per integration that needs an app of its own. Add the key
 * of a new integration here, next to its `Config` entry.
 */
export function integrationConfig(
  config: Pick<Config, 'slack'>,
): IntegrationDefinition.InstanceConfig {
  if (!config.slack) return {}
  const { clientId, clientSecret, apiUrl } = config.slack
  return { slack: { clientId, clientSecret, apiUrl } }
}
