/** When this page load began (module evaluation, before the first query ran). */
const PAGE_LOADED_AT = Date.now()

/**
 * Whether data was fetched (or set) during this page load, not drawn from the stored cache
 * (`query-persist.ts`) that a reload restores. Restored data is right to draw, but wrong to act
 * on where the answer decides a safety rule (does a reject need a reason?): the project may have
 * changed since it was stored, and the refetch that replaces it has not answered yet.
 */
export function fetchedThisLoad(dataUpdatedAt: number): boolean {
  return dataUpdatedAt >= PAGE_LOADED_AT
}
