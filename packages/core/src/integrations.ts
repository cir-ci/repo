/**
 * The integration groups and the part of the catalog that is not a registry definition yet. The
 * catalog the dashboard shows is `integrationCatalog` in `@circi/integrations`: one entry per
 * definition in the registry (built, connectable, with its connect and mapping specs), then the
 * entries below for what has no definition. Static and pure.
 *
 * `INTEGRATION_CATALOG` holds two kinds of entry: `planned` ones (nothing is built) and `available`
 * ones that still use the older, hand-written flow (the git hosts). Migrating an
 * integration to the SDK means writing its definition (docs/integration-sdk.md) and DELETING its
 * entry here; a kind in both is a mistake the registry test catches.
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

export const INTEGRATION_CATALOG: readonly IntegrationCatalog.Entry[] = [
  {
    kind: 'github',
    group: 'git',
    name: 'GitHub',
    description: 'Build status on the pull request, one summary comment, and sign-in with GitHub.',
    status: 'available',
  },
  {
    kind: 'gitlab',
    group: 'git',
    name: 'GitLab',
    description: 'Build status on the merge request, one summary note, and sign-in with GitLab.',
    status: 'available',
  },
  {
    kind: 'bitbucket',
    group: 'git',
    name: 'Bitbucket',
    description: 'Build status on the pull request and one summary comment.',
    status: 'available',
  },
  {
    kind: 'azure-devops',
    group: 'git',
    name: 'Azure DevOps',
    description: 'Build status on the pull request.',
    status: 'planned',
  },
  {
    kind: 'teams',
    group: 'chat',
    name: 'Microsoft Teams',
    description: 'Review notices in a Teams channel per project.',
    status: 'planned',
  },
  {
    kind: 'penpot',
    group: 'design',
    name: 'Penpot',
    description: 'Link snapshots to Penpot boards.',
    status: 'planned',
  },
]

/** The catalog entry for a kind, or undefined for a kind CirCI doesn't list. */
export const catalogEntry = (kind: string): IntegrationCatalog.Entry | undefined =>
  INTEGRATION_CATALOG.find((e) => e.kind === kind)

/** The group a stored kind belongs to, or undefined for a kind CirCI does not list. */
export const groupOfKind = (kind: string): IntegrationCatalog.Group | undefined =>
  catalogEntry(kind)?.group

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
