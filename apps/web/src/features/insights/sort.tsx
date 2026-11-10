import { createContext, type ReactNode, useContext, useState } from 'react'

import { type Accessors, type Sort, sortFromMap, withTableSort } from '#lib/sort.ts'
import { type SortControl, useSorted } from '#lib/use-sorted.ts'

/** The page's `?sort=` text: every sortable table's sort, one entry each. */
interface Keeper {
  text: string | undefined
  onChange: (text: string | undefined) => void
}

const SortKeeper = createContext<Keeper | null>(null)

/** Keeps the tables' sorts in the page's URL; without it each table keeps its own. */
export function InsightsSort(props: Keeper & { children: ReactNode }) {
  const { children, ...keeper } = props
  return <SortKeeper.Provider value={keeper}>{children}</SortKeeper.Provider>
}

/** The sort of one table (`table` is its name in the URL, `keys` its sortable columns). */
export function useTableSort(table: string, keys: readonly string[]): SortControl {
  const keeper = useContext(SortKeeper)
  const local = useState<Sort | null>(null)
  if (!keeper) return local
  return [
    sortFromMap(keeper.text, table, keys),
    (next) => keeper.onChange(withTableSort(keeper.text, table, next)),
  ]
}

/** A table's rows sorted by its sort in the page's URL (or its own, outside the page). */
export function useSortedTable<T>(table: string, rows: readonly T[], accessors: Accessors<T>) {
  const control = useTableSort(table, Object.keys(accessors))
  return useSorted(rows, accessors, control)
}
