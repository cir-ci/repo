/**
 * The filters of a builds list: the query parameters of `GET /api/teams/:workspace/:team`, and
 * the filter JSON of a saved view. One definition for both; the server's zod schema is built
 * from these constants, and `@circi/api`'s `View.Filters` is checked against the type.
 */

export const BUILD_FILTER_STATUSES = [
  'pending',
  'uploading',
  'processing',
  'complete',
  'error',
  'expired',
] as const
export const BUILD_FILTER_REVIEWS = ['pending', 'approved', 'rejected'] as const

export interface BuildFilterValues {
  status?: (typeof BUILD_FILTER_STATUSES)[number]
  review?: (typeof BUILD_FILTER_REVIEWS)[number]
  branch?: string
  author?: string
  reviewer?: string
  name?: string
  /** ISO datetimes. */
  from?: string
  to?: string
}

/**
 * How a builds list is ordered (`order` in the query string): newest or oldest first, the most
 * changed screenshots first, or by status (builds that need attention first). The same four for a
 * team's list and a workspace's.
 */
export const BUILD_ORDERS = ['newest', 'oldest', 'most-changes', 'status'] as const
export type BuildOrder = (typeof BUILD_ORDERS)[number]
