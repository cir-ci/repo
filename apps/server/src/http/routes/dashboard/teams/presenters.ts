import type { Team } from '@circi/api'
import { type Database } from '@circi/db'
import {
  getTeamGitAttention,
  getTeamLink,
  getTeamTokenInfo,
  listWebhookDeliveries,
  listWebhooks,
  type WebhookDelivery,
  type Webhook,
} from '@circi/db/queries'
import { integrationRegistry } from '@circi/integrations'

/** A webhook as the dashboard sees it: the signing secret is only shown when it's created. */
export async function githubLink(db: Database, teamId: string): Promise<Team.GithubLink | null> {
  const link = await getTeamLink(db, teamId, integrationRegistry.gitKinds())
  if (!link) return null
  const attention = await getTeamGitAttention(db, teamId, integrationRegistry.gitKinds())
  return {
    ...link,
    attention: attention
      ? { reason: attention.reason, since: attention.since.toISOString() }
      : null,
  }
}

export async function tokenInfo(
  db: Database,
  teamId: string,
  manageable: boolean,
): Promise<Team.Token> {
  const info = await getTeamTokenInfo(db, teamId)
  return {
    canManage: manageable,
    hint: info.hint,
    createdAt: info.createdAt?.toISOString() ?? null,
    createdBy: info.createdBy,
    lastUsedAt: info.lastUsedAt?.toISOString() ?? null,
  }
}

function presentDelivery(d: WebhookDelivery): Team.WebhookDelivery {
  return {
    deliveryId: d.deliveryId,
    event: d.event,
    test: d.test,
    attempt: d.attempt,
    statusCode: d.statusCode,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
  }
}

export function present(hook: Webhook, deliveries: WebhookDelivery[] = []): Team.Webhook {
  return {
    deliveries: deliveries.map(presentDelivery),
    id: hook.id,
    url: hook.url,
    events: hook.events,
    enabled: hook.enabled,
    createdAt: hook.createdAt.toISOString(),
  }
}

export async function presentWebhooks(db: Database, teamId: string): Promise<Team.Webhook[]> {
  const hooks = await listWebhooks(db, teamId)
  const deliveries = await listWebhookDeliveries(
    db,
    hooks.map((h) => h.id),
  )
  return hooks.map((h) => present(h, deliveries.get(h.id)))
}
