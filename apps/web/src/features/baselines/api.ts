import type { Baseline } from '@circi/api'
import { queryOptions } from '@tanstack/react-query'

import { getJson, seg } from '#lib/http.ts'

export const baselinesQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: ['baselines', workspace, team] as const,
    queryFn: () => getJson<Baseline.List>(`/api/teams/${seg(workspace)}/${seg(team)}/baselines`),
  })

/** The identity of a baseline: a name is unique within a build name. */
export const baselineId = (item: Pick<Baseline.Item, 'buildName' | 'name'>) =>
  `${item.buildName}:${item.name}`

export interface BaselineGroup {
  buildName: string
  items: Baseline.Item[]
}

/** Baselines whose name, build name or commit contains `query` (case-insensitive); all when blank. */
export function filterBaselines(items: readonly Baseline.Item[], query: string): Baseline.Item[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter((i) =>
    [i.name, i.buildName, i.commitSha, `#${i.buildNumber}`].some((s) =>
      s.toLowerCase().includes(q),
    ),
  )
}

/** Groups by build name (the usual "default" first, then alphabetical), each group sorted by name. */
export function groupBaselines(items: readonly Baseline.Item[]): BaselineGroup[] {
  const byBuild = new Map<string, Baseline.Item[]>()
  for (const item of items)
    byBuild.set(item.buildName, [...(byBuild.get(item.buildName) ?? []), item])
  return [...byBuild.entries()]
    .toSorted(([a], [b]) =>
      a === b ? 0 : a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b),
    )
    .map(([buildName, list]) => ({
      buildName,
      items: list.toSorted((a, b) => a.name.localeCompare(b.name)),
    }))
}

/** The groups as one list in on-screen order, for J / K. */
export const flattenGroups = (groups: readonly BaselineGroup[]): Baseline.Item[] =>
  groups.flatMap((g) => g.items)

/** "1280 × 720", or nothing when the size is unknown. */
export const dimensionsLabel = (item: Pick<Baseline.Item, 'width' | 'height'>) =>
  item.width && item.height ? `${item.width} × ${item.height}` : ''

/** "12 kB" up to a megabyte, then "1.4 MB"; nothing when unknown. */
export const sizeLabel = (bytes: number | null) =>
  bytes === null
    ? ''
    : bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} kB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** "3 baselines", or "2 of 3 baselines" while a filter hides some. */
export const countLabel = (shown: number, total: number) => {
  const noun = total === 1 ? 'baseline' : 'baselines'
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`
}
