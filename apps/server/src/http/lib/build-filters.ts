import { BUILD_FILTER_REVIEWS, BUILD_FILTER_STATUSES } from '@circi/core'
import { z } from 'zod'

/**
 * The builds filters, as a zod shape: the query of the builds list and the filter JSON of a
 * saved view are both parsed with this one definition (values come from `@circi/core`).
 */
export const buildFilterShape = {
  status: z.enum(BUILD_FILTER_STATUSES).optional(),
  review: z.enum(BUILD_FILTER_REVIEWS).optional(),
  branch: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  reviewer: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
}

/** For saved views: unknown keys are refused rather than silently kept. */
export const savedFilters = z.strictObject(buildFilterShape)
