/**
 * The integrations CirCI knows about: every provider an organisation can add, and the ones that are
 * only planned. Static and pure, so the server, the web app and the tests read one list.
 *
 * Adding a provider: add its entry here (status `available`), its kind to `GIT_PROVIDER_KINDS`
 * or `INTEGRATION_KINDS` in `@circi/db`, and a logo in `apps/web/src/features/integrations/`.
 */

export const INTEGRATION_GROUPS = ['git', 'chat', 'design', 'tracker'] as const
export type IntegrationGroup = (typeof INTEGRATION_GROUPS)[number]

export const INTEGRATION_GROUP_LABEL: Record<IntegrationGroup, string> = {
  git: 'Git hosts',
  chat: 'Chat',
  design: 'Design tools',
  tracker: 'Issue trackers',
}

export type IntegrationStatus = 'available' | 'planned'

export interface CatalogEntry {
  /** Stable id: the `kind` stored on a connection or integration. */
  kind: string
  group: IntegrationGroup
  name: string
  description: string
  /** `planned` entries are shown disabled and have no backend. */
  status: IntegrationStatus
}

export const INTEGRATION_CATALOG: readonly CatalogEntry[] = [
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
    kind: 'slack',
    group: 'chat',
    name: 'Slack',
    description: 'Review requested, overdue and rejected notices in a channel per project.',
    status: 'available',
  },
  {
    kind: 'teams',
    group: 'chat',
    name: 'Microsoft Teams',
    description: 'Review notices in a Teams channel per project.',
    status: 'planned',
  },
  {
    kind: 'figma',
    group: 'design',
    name: 'Figma',
    description: 'Link snapshots to frames, compare with the design, and post results on frames.',
    status: 'available',
  },
  {
    kind: 'penpot',
    group: 'design',
    name: 'Penpot',
    description: 'Link snapshots to Penpot boards.',
    status: 'planned',
  },
  {
    kind: 'linear',
    group: 'tracker',
    name: 'Linear',
    description: 'Create an issue from a rejected snapshot, with the diff attached.',
    status: 'available',
  },
  {
    kind: 'jira',
    group: 'tracker',
    name: 'Jira',
    description: 'Create an issue from a rejected snapshot, with the diff attached.',
    status: 'available',
  },
]

/** The catalog entry for a kind, or undefined for a kind CirCI doesn't list. */
export const catalogEntry = (kind: string): CatalogEntry | undefined =>
  INTEGRATION_CATALOG.find((e) => e.kind === kind)

/** The group a stored kind belongs to, or undefined for a kind CirCI does not list. */
export const groupOfKind = (kind: string): IntegrationGroup | undefined => catalogEntry(kind)?.group

/** Entries matching a search text (name, kind or description) and an optional group. */
export function filterCatalog(
  entries: readonly CatalogEntry[],
  filter: { query?: string; group?: IntegrationGroup | 'all' },
): CatalogEntry[] {
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
