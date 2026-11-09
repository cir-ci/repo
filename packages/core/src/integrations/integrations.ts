/**
 * The integration groups and the pure rules the dashboard and the server share. The catalog itself
 * (one entry per definition in the registry, plus the planned entries) lives in `@circi/integrations`
 * (`sdk/catalog.ts`, `sdk/public.ts`); this file holds only what the browser-safe root has to offer
 * on its own: the group names and labels, the entry types, text filtering, the installation id rule.
 */

export const INTEGRATION_GROUPS = ['git', 'chat', 'design', 'tracker'] as const

export namespace IntegrationCatalog {
  export type Group = (typeof INTEGRATION_GROUPS)[number]

  export type Status = 'available' | 'planned'

  export interface Entry {
    /** Stable id: the `kind` stored on a connection or integration. */
    kind: string
    group: Group
    name: string
    description: string
    /** `planned` entries are shown disabled and have no backend. */
    status: Status
  }
}

export const INTEGRATION_GROUP_LABEL: Record<IntegrationCatalog.Group, string> = {
  git: 'Git hosts',
  chat: 'Chat',
  design: 'Design tools',
  tracker: 'Issue trackers',
}

/** A GitHub App installation id: digits only. The one definition, for the server and the dashboard. */
export const INSTALLATION_ID_RE = /^\d{1,20}$/

/** Whether the text (padding ignored) is a GitHub App installation id. */
export const isInstallationId = (value: string) => INSTALLATION_ID_RE.test(value.trim())

/** The label of a group's heading. */
export const integrationGroupLabel = (group: IntegrationCatalog.Group) =>
  INTEGRATION_GROUP_LABEL[group]

/** Entries matching a search text (name, kind or description) and an optional group. */
export function filterCatalog<
  E extends Pick<IntegrationCatalog.Entry, 'kind' | 'group' | 'name' | 'description'>,
>(
  entries: readonly E[],
  filter: { query?: string; group?: IntegrationCatalog.Group | 'all' },
): E[] {
  const q = (filter.query ?? '').trim().toLowerCase()
  return entries.filter(
    (e) =>
      (!filter.group || filter.group === 'all' || e.group === filter.group) &&
      (!q ||
        e.name.toLowerCase().includes(q) ||
        e.kind.includes(q) ||
        e.description.toLowerCase().includes(q)),
  )
}
