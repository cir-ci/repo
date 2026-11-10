import { useState } from 'react'

import { type Accessors, ariaSort, nextSort, type Sort, sortRows } from './sort.ts'

/** Where a table's sort is kept when it isn't the table's own state (the page's URL, say). */
export type SortControl = readonly [Sort | null, (next: Sort | null) => void]

/**
 * A sortable table's rows and header props. Give it the rows in their own order and an accessor
 * per sortable column; `header(key)` is what `SortableHeader` takes (`sort`, `onSort`). The sort
 * is local state unless `control` keeps it somewhere else.
 */
export function useSorted<T>(rows: readonly T[], accessors: Accessors<T>, control?: SortControl) {
  const local = useState<Sort | null>(null)
  const [sort, setSort] = control ?? local
  return {
    rows: sortRows(rows, accessors, sort),
    sort,
    header: (key: string) => ({
      sort: ariaSort(sort, key),
      onSort: () => setSort(nextSort(sort, key)),
    }),
  }
}
