import { INTEGRATION_GROUPS, type IntegrationCatalog } from '@circi/core'

import type { Database } from '#src/client.ts'

import { listIntegrations } from './workspace-integrations.ts'

export namespace listWorkspaceIntegrations {
  /** What the caller knows about a kind: the registry's definitions plus the planned catalog entries. */
  export interface Kind {
    group: IntegrationCatalog.Group
    name: string
  }

  /** Looks a stored kind up; undefined for one nobody lists (its rows are left out). */
  export type Resolve = (kind: string) => Kind | undefined

  /** One row of the workspace's Integrations page. */
  export interface Item {
    id: string
    kind: string
    group: IntegrationCatalog.Group
    /** The provider's name (`Slack`), for labels. */
    kindName: string
    name: string
    needsAttention: boolean
    attentionReason: string | null
    teamCount: number
    createdAt: Date
  }
}

/**
 * Everything the workspace has connected, git hosts and other integrations in one list, grouped
 * by kind for display (git hosts first, then chat, design tools, trackers), oldest first within
 * a group. Rows whose kind `resolve` doesn't know are left out.
 */
export async function listWorkspaceIntegrations(
  db: Database,
  workspaceId: string,
  resolve: listWorkspaceIntegrations.Resolve,
): Promise<listWorkspaceIntegrations.Item[]> {
  const others = await listIntegrations(db, workspaceId)
  const items: listWorkspaceIntegrations.Item[] = []
  for (const i of others) {
    const known = resolve(i.kind)
    if (!known) continue
    items.push({
      id: i.id,
      kind: i.kind,
      group: known.group,
      kindName: known.name,
      name: i.displayName,
      needsAttention: i.needsAttention,
      attentionReason: i.needsAttentionReason,
      teamCount: i.teamCount,
      createdAt: i.createdAt,
    })
  }
  const order: readonly IntegrationCatalog.Group[] = INTEGRATION_GROUPS
  return items.toSorted(
    (a, b) =>
      order.indexOf(a.group) - order.indexOf(b.group) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )
}
