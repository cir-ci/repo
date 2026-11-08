import type { Integration } from '@circi/api'

export const item = (over: Partial<Integration.Item> & Pick<Integration.Item, 'kind'>) =>
  ({
    id: over.id ?? `id-${over.kind}`,
    source: 'integration',
    group: 'git',
    name: over.kind,
    needsAttention: false,
    attentionReason: null,
    projectCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }) satisfies Integration.Item

export const entry = (
  over: Partial<Integration.CatalogEntry> & Pick<Integration.CatalogEntry, 'kind' | 'name'>,
): Integration.CatalogEntry => ({
  group: 'git',
  description: `${over.name} description`,
  status: 'available',
  connectable: true,
  ...over,
})

export const CATALOG: Integration.CatalogEntry[] = [
  entry({ kind: 'github', name: 'GitHub' }),
  entry({ kind: 'gitlab', name: 'GitLab', connectable: false }),
  entry({ kind: 'azure-devops', name: 'Azure DevOps', status: 'planned', connectable: false }),
  entry({ kind: 'slack', name: 'Slack', group: 'chat', connectable: false }),
  entry({
    kind: 'teams',
    name: 'Microsoft Teams',
    group: 'chat',
    status: 'planned',
    connectable: false,
  }),
  entry({ kind: 'figma', name: 'Figma', group: 'design', connectable: false }),
]
