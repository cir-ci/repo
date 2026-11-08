import { catalogEntry, type IntegrationCatalog } from '@circi/core'

import type { IntegrationRegistry } from './registry.ts'

/** What the Integrations list needs to know about a stored kind: the registry first, then the static catalog. */
export function resolveKind(
  registry: IntegrationRegistry,
  kind: string,
): { group: IntegrationCatalog.Group; name: string; pageStyle: 'generic' | 'custom' } | undefined {
  const def = registry.get(kind)
  if (def) return { group: def.group, name: def.name, pageStyle: def.pageStyle }
  const entry = catalogEntry(kind)
  return entry ? { group: entry.group, name: entry.name, pageStyle: 'custom' } : undefined
}
