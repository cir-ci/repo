import type { Config } from '@circi/config'
import type { IntegrationDefinition } from '@circi/integrations'

/**
 * One object per configuration, shared by the HTTP server, the webhook and the worker: it is live.
 * A GitHub App created in the dashboard is put into it, so every part sees the App at once.
 */
const built = new WeakMap<object, IntegrationDefinition.InstanceConfig>()

/**
 * The instance settings the integration definitions read (`IntegrationDefinition.InstanceConfig`),
 * from the configuration: one key per integration that needs an app of its own. Add the key
 * of a new integration here, next to its `Config` entry.
 */
export function integrationConfig(
  config: Pick<Config, 'slack' | 'github'>,
): IntegrationDefinition.InstanceConfig {
  const known = built.get(config)
  if (known) return known
  const out: IntegrationDefinition.InstanceConfig = {}
  if (config.slack) {
    const { clientId, clientSecret, apiUrl } = config.slack
    out.slack = { clientId, clientSecret, apiUrl }
  }
  if (config.github) {
    const { apiUrl, appId, privateKey, webhookSecret, timeoutMs } = config.github
    out.github = { apiUrl, appId, privateKey, webhookSecret, timeoutMs }
  }
  built.set(config, out)
  return out
}
