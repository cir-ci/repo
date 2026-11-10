import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { user } from './auth.ts'
import { teams } from './teams.ts'

/**
 * What a dashboard action did to its subject, kept just long enough for its person to take it back
 * (the Undo on a toast). One row per undoable action: `data` holds the state before it and what
 * the action set, so a later undo can tell whether something newer changed the same thing. Single
 * use (`used_at`), and only until `expires_at`. Rows are history, not state: nothing reads them
 * except the undo itself and a build's activity (a used `build_review` row is "undid approving").
 */
export const UNDO_KINDS = [
  'build_review',
  'triage_assign',
  'triage_snooze',
  'triage_dismiss',
  'notice_read',
  'notice_snooze',
  'notice_remove',
  'request_snooze',
  'request_review',
] as const
export type UndoKind = (typeof UNDO_KINDS)[number]

export const undoActions = pgTable(
  'undo_actions',
  {
    id: id(),
    /** The only person who may undo it. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The team the route is scoped to; null for the person's own inbox. */
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<UndoKind>().notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    index('undo_actions_user_idx').on(t.userId, t.createdAt),
    check('undo_actions_kind_check', inList('kind', UNDO_KINDS)),
  ],
)
