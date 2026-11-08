import type { Integration } from '@circi/api'

const NAMES: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  slack: 'Slack',
  figma: 'Figma',
  linear: 'Linear',
  jira: 'Jira',
}

export const item = (over: Partial<Integration.Item> & Pick<Integration.Item, 'kind'>) =>
  ({
    id: over.id ?? `id-${over.kind}`,
    source: 'integration',
    group: 'git',
    kindName: NAMES[over.kind] ?? over.kind,
    pageStyle: over.kind === 'slack' ? 'generic' : 'custom',
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
  built: true,
  connectable: true,
  pageStyle: 'custom',
  logo: over.kind,
  credentials: [],
  oauth: false,
  mapping: null,
  ...over,
})

export const CATALOG: Integration.CatalogEntry[] = [
  entry({ kind: 'github', name: 'GitHub' }),
  entry({ kind: 'gitlab', name: 'GitLab', built: false, connectable: false }),
  entry({
    kind: 'azure-devops',
    name: 'Azure DevOps',
    status: 'planned',
    built: false,
    connectable: false,
  }),
  entry({ kind: 'slack', name: 'Slack', group: 'chat', built: false, connectable: false }),
  entry({
    kind: 'teams',
    name: 'Microsoft Teams',
    group: 'chat',
    status: 'planned',
    built: false,
    connectable: false,
  }),
  entry({ kind: 'figma', name: 'Figma', group: 'design', built: false, connectable: false }),
]
