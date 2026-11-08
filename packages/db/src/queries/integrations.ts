import { catalogEntry, INTEGRATION_GROUPS, type IntegrationCatalog } from '@circi/core'

import { listGitConnections } from '#repositories/git.ts'
import { listIntegrations } from '#repositories/integrations.ts'
import type { Database } from '#src/client.ts'

export namespace listOrgIntegrations {
  /** What the caller knows about a kind: the registry's definitions plus the static catalog. */
  export interface Kind {
    group: IntegrationCatalog.Group
    name: string
    pageStyle: 'generic' | 'custom'
  }

  /** Looks a stored kind up; undefined for one nobody lists (its rows are left out). */
  export type Resolve = (kind: string) => Kind | undefined

  /** One row of the organisation's Integrations page: a git connection or another integration. */
  export interface Item {
    id: string
    /** Which table the id is in: git hosts are `provider_connections`, the rest `integrations`. */
    source: 'connection' | 'integration'
    kind: string
    group: IntegrationCatalog.Group
    /** The provider's name (`Slack`), for labels. */
    kindName: string
    /** `generic` kinds are configured on the one generic page (`/integrations/:kind/:id`). */
    pageStyle: Kind['pageStyle']
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
  return entry ? { group: entry.group, name: entry.name, pageStyle: 'custom' } : undefined
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
  const [connections, others] = await Promise.all([
    listGitConnections(db, orgId),
    listIntegrations(db, orgId),
  ])
  const items: listOrgIntegrations.Item[] = []
  for (const c of connections) {
    const known = resolve(c.kind)
    if (!known) continue
    items.push({
      id: c.id,
      source: 'connection',
      kind: c.kind,
      group: known.group,
      kindName: known.name,
      pageStyle: known.pageStyle,
      name: c.kind === 'github' ? `Installation ${c.externalId}` : c.externalId,
      needsAttention: c.needsAttention !== null,
      attentionReason: c.needsAttention,
      projectCount: c.projectCount,
      createdAt: c.createdAt,
    })
  }
  for (const i of others) {
    const known = resolve(i.kind)
    if (!known) continue
    items.push({
      id: i.id,
      source: 'integration',
      kind: i.kind,
      group: known.group,
      kindName: known.name,
      pageStyle: known.pageStyle,
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
