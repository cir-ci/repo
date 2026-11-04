import type {
  builds,
  files,
  jobs,
  organizations,
  projects,
  screenshotDiffs,
  screenshots,
} from './schema/index.ts'

/** Row types, as read from and written to the database. */

export type Organization = typeof organizations.$inferSelect
export type Project = typeof projects.$inferSelect
export type Build = typeof builds.$inferSelect
export type Screenshot = typeof screenshots.$inferSelect
export type ScreenshotDiff = typeof screenshotDiffs.$inferSelect
export type NewScreenshotDiff = typeof screenshotDiffs.$inferInsert
export type FileRow = typeof files.$inferSelect
export type Job = typeof jobs.$inferSelect
