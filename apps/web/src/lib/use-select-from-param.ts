import { useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * A list page that can be opened with an item chosen (`?item=<id>`, from a search result or a
 * link): puts that item's id in the list's cursor, so it is the selected row once the list has it.
 */
export function useSelectFromParam(
  select: (id: string | undefined) => void,
  param = 'item',
): string | undefined {
  const id = useRouterState({
    select: (s) => {
      const value = (s.location.search as Record<string, unknown>)[param]
      return typeof value === 'string' && value !== '' ? value : undefined
    },
  })
  useEffect(() => {
    if (id !== undefined) select(id)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the choice is made when the address changes
  }, [id])
  return id
}
