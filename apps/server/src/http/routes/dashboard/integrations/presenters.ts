import type { Integration } from '@circi/api'
import { canManage } from '@circi/core'
import type { IntegrationLink } from '@circi/db/queries'
import type { IntegrationDefinition } from '@circi/integrations'

/** A target as the dashboard gets it. */
export function wireTarget(t: IntegrationDefinition.Target): Integration.Target {
  const out: Integration.Target = { id: t.id, name: t.name }
  if (t.label) out.label = t.label
  return out
}

/** A link as the dashboard gets it. */
export const wireLink = (l: IntegrationLink.Row): Integration.Link => ({
  id: l.id,
  subject: l.subject ?? '',
  ref: l.externalRef,
  url: l.url,
  title: l.title,
  source: l.payload.source === 'auto' ? 'auto' : 'manual',
  createdAt: l.createdAt.toISOString(),
})

/**
 * The address a git host calls, and the secret to put on it (owners and admins only; a host whose
 * secret is configured elsewhere has none to show). Null for an integration with no webhook.
 */
export function webhookOf(
  definition: IntegrationDefinition,
  ctx: IntegrationDefinition.Context | undefined,
  publicOrigin: string,
  role: string | undefined,
): Integration.MappingPage['webhook'] {
  const git = definition.capabilities.git
  if (!git) return null
  const canSee = canManage(role)
  return {
    url: `${publicOrigin}/webhooks/${definition.id}`,
    secret: canSee && ctx ? (git.webhook.secret?.(ctx) ?? null) : null,
  }
}
