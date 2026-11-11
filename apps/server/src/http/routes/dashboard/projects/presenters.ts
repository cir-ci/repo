import type { Project } from '@circi/api'
import { type Database } from '@circi/db'
import {
  getProjectGitAttention,
  getProjectLink,
  getProjectTokenInfo,
  listWebhookDeliveries,
  listWebhooks,
  type WebhookDelivery,
  type Webhook,
} from '@circi/db/queries'
import { integrationRegistry } from '@circi/integrations'

/** A webhook as the dashboard sees it: the signing secret is only shown when it's created. */
export async function githubLink(
  db: Database,
  projectId: string,
): Promise<Project.GithubLink | null> {
  const link = await getProjectLink(db, projectId, integrationRegistry.gitKinds())
  if (!link) return null
  const attention = await getProjectGitAttention(db, projectId, integrationRegistry.gitKinds())
  return {
    ...link,
    attention: attention
      ? { reason: attention.reason, since: attention.since.toISOString() }
      : null,
  }
}

export async function tokenInfo(
  db: Database,
  projectId: string,
  manageable: boolean,
): Promise<Project.Token> {
  const info = await getProjectTokenInfo(db, projectId)
  return {
    canManage: manageable,
    hint: info.hint,
    createdAt: info.createdAt?.toISOString() ?? null,
    createdBy: info.createdBy,
    lastUsedAt: info.lastUsedAt?.toISOString() ?? null,
  }
}

function presentDelivery(d: WebhookDelivery): Project.WebhookDelivery {
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

export function present(hook: Webhook, deliveries: WebhookDelivery[] = []): Project.Webhook {
  return {
    deliveries: deliveries.map(presentDelivery),
    id: hook.id,
    url: hook.url,
    events: hook.events,
    enabled: hook.enabled,
    createdAt: hook.createdAt.toISOString(),
  }
}

export async function presentWebhooks(db: Database, projectId: string): Promise<Project.Webhook[]> {
  const hooks = await listWebhooks(db, projectId)
  const deliveries = await listWebhookDeliveries(
    db,
    hooks.map((h) => h.id),
  )
  return hooks.map((h) => present(h, deliveries.get(h.id)))
}
