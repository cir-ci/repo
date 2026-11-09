import type { Integration } from '@circi/api'
import {
  filterCatalog,
  INTEGRATION_GROUP_LABEL,
  INTEGRATION_GROUPS,
} from '@circi/core/integrations'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { workspacePath } from '#lib/api-paths.ts'
import { getJson, send } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------

export type GroupFilter = Integration.Group | 'all'

export const GROUPS: readonly { value: Integration.Group; label: string }[] =
  INTEGRATION_GROUPS.map((value) => ({ value, label: INTEGRATION_GROUP_LABEL[value] }))

/** The added integrations under their group headings, in the canvas order; empty groups left out. */
export function groupItems(
  items: readonly Integration.Item[],
): { group: Integration.Group; label: string; items: Integration.Item[] }[] {
  return GROUPS.flatMap(({ value, label }) => {
    const inGroup = items.filter((i) => i.group === value)
    return inGroup.length > 0 ? [{ group: value, label, items: inGroup }] : []
  })
}

export const isGroupFilter = (value: string): value is GroupFilter =>
  value === 'all' || GROUPS.some((g) => g.value === value)

export { filterCatalog }

/** What a tile says when it can't be picked, or null when it can. */
export function unavailableNote(entry: Integration.CatalogEntry): string | null {
  if (entry.status === 'planned') return 'Planned'
  if (!entry.built) return 'Coming soon'
  if (!entry.connectable) return 'Not set up on this server'
  return null
}

/**
 * How an added integration is named in labels and titles: the provider's display name, then the
 * account it is connected to ("GitHub (Installation 501)", "Slack (Acme Slack)").
 */
export const integrationLabel = (item: Pick<Integration.Item, 'kindName' | 'name'>) =>
  `${item.kindName} (${item.name})`

/** "3 teams", "1 team", "No teams yet". */
export const teamCountLabel = (count: number) =>
  count === 0 ? 'No teams yet' : `${count} ${count === 1 ? 'team' : 'teams'}`

// ---- Server state -----------------------------------------------------------------------------

const base = (workspace: string, ...rest: string[]) =>
  workspacePath(workspace, 'integrations', ...rest)

export const integrationsQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.integrations(workspace),
    queryFn: () => getJson<Integration.ListResponse>(base(workspace)),
  })

export function useRemoveIntegration(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (item: Pick<Integration.Item, 'id'>) =>
      send<undefined>('DELETE', base(workspace, item.id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.integrations(workspace) }),
  })
}
