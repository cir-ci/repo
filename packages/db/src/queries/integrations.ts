import { catalogEntry, INTEGRATION_GROUPS, type IntegrationCatalog } from '@circi/core'

import { listIntegrations } from '#repositories/integrations.ts'
import type { Database } from '#src/client.ts'

export namespace listOrgIntegrations {
  /** What the caller knows about a kind: the registry's definitions plus the static catalog. */
  export interface Kind {
    group: IntegrationCatalog.Group
    name: string
  }

  /** Looks a stored kind up; undefined for one nobody lists (its rows are left out). */
  export type Resolve = (kind: string) => Kind | undefined

  /** One row of the organisation's Integrations page. */
  export interface Item {
    id: string
    kind: string
    group: IntegrationCatalog.Group
    /** The provider's name (`Slack`), for labels. */
    kindName: string
    name: string
    needsAttention: boolean
    attentionReason: string | null
    projectCount: number
    createdAt: Date
  }
}

/** The static catalog's kinds, all configured on their own pages. */
const staticKind: listOrgIntegrations.Resolve = (kind) => {
  const entry = catalogEntry(kind)
  return entry ? { group: entry.group, name: entry.name } : undefined
}

/**
 * Everything the organisation has connected, git hosts and other integrations in one list, grouped
 * by kind for display (git hosts first, then chat, design tools, trackers), oldest first within
 * a group. Rows whose kind the catalog doesn't know are left out.
 */
export async function listOrgIntegrations(
  db: Database,
  orgId: string,
  resolve: listOrgIntegrations.Resolve = staticKind,
): Promise<listOrgIntegrations.Item[]> {
  const others = await listIntegrations(db, orgId)
  const items: listOrgIntegrations.Item[] = []
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
      projectCount: i.projectCount,
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
