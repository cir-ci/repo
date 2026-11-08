import { groupOfKind, type IntegrationGroup } from '@circi/core'

import type { Database } from '../client.ts'
import { listGitConnections } from '../repositories/git.ts'
import { listIntegrations } from '../repositories/integrations.ts'

/** One row of the organisation's Integrations page: a git connection or another integration. */
export interface IntegrationItem {
  id: string
  /** Which table the id is in: git hosts are `provider_connections`, the rest `integrations`. */
  source: 'connection' | 'integration'
  kind: string
  group: IntegrationGroup
  name: string
  needsAttention: boolean
  attentionReason: string | null
  projectCount: number
  createdAt: Date
}

/**
 * Everything the organisation has connected, git hosts and other integrations in one list, grouped
 * by kind for display (git hosts first, then chat, design tools, trackers), oldest first within
 * a group. Rows whose kind the catalog doesn't know are left out.
 */
export async function listOrgIntegrations(db: Database, orgId: string): Promise<IntegrationItem[]> {
  const [connections, others] = await Promise.all([
    listGitConnections(db, orgId),
    listIntegrations(db, orgId),
  ])
  const items: IntegrationItem[] = []
  for (const c of connections) {
    const group = groupOfKind(c.kind)
    if (!group) continue
    items.push({
      id: c.id,
      source: 'connection',
      kind: c.kind,
      group,
      name: `Installation ${c.externalId}`,
      needsAttention: c.needsAttention !== null,
      attentionReason: c.needsAttention,
      projectCount: c.projectCount,
      createdAt: c.createdAt,
    })
  }
  for (const i of others) {
    const group = groupOfKind(i.kind)
    if (!group) continue
    items.push({
      id: i.id,
      source: 'integration',
      kind: i.kind,
      group,
      name: i.displayName,
      needsAttention: i.needsAttention,
      attentionReason: i.needsAttentionReason,
      projectCount: i.projectCount,
      createdAt: i.createdAt,
    })
  }
  const order: IntegrationGroup[] = ['git', 'chat', 'design', 'tracker']
  return items.toSorted(
    (a, b) =>
      order.indexOf(a.group) - order.indexOf(b.group) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )
}
