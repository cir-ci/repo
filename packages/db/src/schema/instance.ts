import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/** Instance-wide settings and bookkeeping as key/value text (JSON where a value has fields). */
export const instanceSettings = pgTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
