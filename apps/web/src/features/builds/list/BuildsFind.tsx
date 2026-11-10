import { useFindText } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'

import type { BuildFilters } from './builds-filters.ts'

/**
 * The find field of a builds list, for the page header (`PageHeading`'s `find`): free text (a
 * build number, PR, commit, name, branch or author) that is a filter like the chips, kept as
 * `filters.q`.
 */
export function BuildsFind({ filters, onFiltersChange }: BuildsFind.Props) {
  const [text, setText] = useFindText(filters.q ?? '', (q) => {
    const { q: _previous, ...rest } = filters
    onFiltersChange(q.trim() === '' ? rest : { ...rest, q: q.trim() })
  })
  return <FindField noun="builds" value={text} onChange={setText} />
}

export namespace BuildsFind {
  export interface Props {
    filters: BuildFilters
    onFiltersChange: (filters: BuildFilters) => void
  }
}
