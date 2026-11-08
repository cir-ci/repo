import type { Integration } from '@circi/api'
import {
  filterCatalog,
  INTEGRATION_GROUP_LABEL,
  INTEGRATION_GROUPS,
} from '@circi/core/integrations'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, seg, send } from '#lib/http.ts'

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

/** "3 projects", "1 project", "No projects yet". */
export const projectCountLabel = (count: number) =>
  count === 0 ? 'No projects yet' : `${count} ${count === 1 ? 'project' : 'projects'}`

// ---- Server state -----------------------------------------------------------------------------

const base = (org: string) => `/api/orgs/${seg(org)}/integrations`

export const integrationsQuery = (org: string) =>
  queryOptions({
    queryKey: ['integrations', org],
    queryFn: () => getJson<Integration.ListResponse>(base(org)),
  })

export function useRemoveIntegration(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (item: Pick<Integration.Item, 'id'>) =>
      send<undefined>('DELETE', `${base(org)}/${seg(item.id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}
