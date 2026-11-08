import type {
  builds,
  comments,
  files,
  jobs,
  notifications,
  organization,
  projects,
  reviewRequests,
  screenshotDiffs,
  screenshots,
  user,
} from './schema/index.ts'

/** Row types, as read from and written to the database. */

export type Organization = typeof organization.$inferSelect
export type User = typeof user.$inferSelect
export type Project = typeof projects.$inferSelect
export type Build = typeof builds.$inferSelect
export type Screenshot = typeof screenshots.$inferSelect
export type ScreenshotDiff = typeof screenshotDiffs.$inferSelect
export type NewScreenshotDiff = typeof screenshotDiffs.$inferInsert
export type FileRow = typeof files.$inferSelect
export type ReviewRequest = typeof reviewRequests.$inferSelect
export type Job = typeof jobs.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type Comment = typeof comments.$inferSelect
