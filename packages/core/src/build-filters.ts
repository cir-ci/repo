/**
 * The filters of a builds list: the query parameters of `GET /api/projects/:org/:project`, and
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
