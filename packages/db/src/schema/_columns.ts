import { sql } from 'drizzle-orm'
import { timestamp, uuid } from 'drizzle-orm/pg-core'

/** Column and constraint helpers shared by the table files. Not part of the public schema. */

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
export const id = () => uuid('id').primaryKey().defaultRandom()

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ')
/** CHECK that a text column holds one of `values`. */
export const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${quoted(values)})`)
/** Like `inList`, but NULL is allowed too. */
export const inListOrNull = (column: string, values: readonly string[]) =>
  sql.raw(`${column} is null or ${column} in (${quoted(values)})`)
