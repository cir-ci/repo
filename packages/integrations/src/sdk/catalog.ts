import type { IntegrationCatalog } from '@circi/core'

/**
 * The part of the catalog that is not a registry definition yet: `planned` entries (nothing is built).
 * The catalog the dashboard shows is `buildCatalog` (`public.ts`): one entry per definition in the
 * registry (built, connectable, with its connect and mapping specs), then the entries below for what
 * has no definition. Static and pure.
 *
 * Building one means writing its definition (docs/integration-sdk.md) and DELETING its entry here;
 * a kind in both is a mistake the registry test catches.
 */
export const INTEGRATION_CATALOG: readonly IntegrationCatalog.Entry[] = [
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
    description: 'Review notices in a Teams channel per team.',
    status: 'planned',
  },
  {
    kind: 'penpot',
    group: 'design',
    name: 'Penpot',
    description: 'Link screenshots to Penpot boards.',
    status: 'planned',
  },
]

/** The catalog entry for a kind, or undefined for a kind CirCI doesn't list. */
export const catalogEntry = (kind: string): IntegrationCatalog.Entry | undefined =>
  INTEGRATION_CATALOG.find((e) => e.kind === kind)
