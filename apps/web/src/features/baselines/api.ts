import type { Baseline } from '@circi/api'
import { queryOptions } from '@tanstack/react-query'

import { teamPath } from '#lib/api-paths.ts'
import { getJson } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

export const baselinesQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.baselines(workspace, team),
    queryFn: () => getJson<Baseline.List>(teamPath(workspace, team, 'baselines')),
  })

/** The identity of a baseline: a name is unique within a build name. */
export const baselineId = (item: Pick<Baseline.Item, 'buildName' | 'name'>) =>
  `${item.buildName}:${item.name}`

export interface BaselineGroup {
  /** The part of the name before its first "/"; null for the screenshots that have none. */
  prefix: string | null
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

/** The part of a snapshot name before its first "/", or null when there is none (or nothing before it). */
export function namePrefix(name: string): string | null {
  const i = name.indexOf('/')
  const prefix = i > 0 ? name.slice(0, i).trim() : ''
  return prefix === '' ? null : prefix
}

/**
 * Groups by name prefix (alphabetical), each group sorted by name; the screenshots without a
 * prefix come last in a group of their own.
 */
export function groupBaselines(items: readonly Baseline.Item[]): BaselineGroup[] {
  const byPrefix = new Map<string | null, Baseline.Item[]>()
  for (const item of items) {
    const key = namePrefix(item.name)
    byPrefix.set(key, [...(byPrefix.get(key) ?? []), item])
  }
  return [...byPrefix.entries()]
    .toSorted(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([prefix, list]) => ({
      prefix,
      items: list.toSorted((a, b) => a.name.localeCompare(b.name)),
    }))
}

/** The groups as one list in on-screen order, for J / K. */
export const flattenGroups = (groups: readonly BaselineGroup[]): Baseline.Item[] =>
  groups.flatMap((g) => g.items)
