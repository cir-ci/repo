import { BUILD_FILTER_REVIEWS, BUILD_FILTER_STATUSES } from '@circi/core'
import type { listBuildsForTeam } from '@circi/db/queries'
import { z } from 'zod'

/**
 * The builds filters, as a zod shape: the query of the builds list and the filter JSON of a
 * saved view are both parsed with this one definition (values come from `@circi/core`).
 */
export const buildFilterShape = {
  status: z.enum(BUILD_FILTER_STATUSES).optional(),
  review: z.enum(BUILD_FILTER_REVIEWS).optional(),
  branch: z.string().min(1).optional(),
  branchContains: z.string().min(1).max(255).optional(),
  author: z.string().min(1).optional(),
  reviewer: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
}

/** For saved views: unknown keys are refused rather than silently kept. */
export const savedFilters = z.strictObject(buildFilterShape)

/** The parsed filters (a request's query) as the builds queries take them. */
export function toBuildFilters(
  q: Partial<z.infer<z.ZodObject<typeof buildFilterShape>>>,
): listBuildsForTeam.Filters {
  return {
    ...(q.status ? { status: q.status } : {}),
    ...(q.review ? { reviewStatus: q.review } : {}),
    ...(q.branch ? { branch: q.branch } : {}),
    ...(q.branchContains ? { branchContains: q.branchContains } : {}),
    ...(q.author ? { author: q.author } : {}),
    ...(q.reviewer ? { reviewer: q.reviewer } : {}),
    ...(q.name ? { name: q.name } : {}),
    ...(q.from ? { from: new Date(q.from) } : {}),
    ...(q.to ? { to: new Date(q.to) } : {}),
  }
}
