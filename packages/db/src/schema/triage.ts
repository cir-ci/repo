import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id, inList, inListOrNull } from './_columns.ts'
import { user } from './auth.ts'
import { SNOOZE_KINDS, type SnoozeKind, TRIAGE_KINDS, type TriageKind } from './enums.ts'
import { teams } from './teams.ts'

/**
 * Triage: a team's queue of problems nobody has dealt with (flaky snapshots, missing
 * baselines, failed builds). The problems themselves are derived from builds when read
 * (`listTriage`); `triage_items` only holds what people did about them, keyed by what kind of
 * problem it is and which one (`key`: the snapshot name, or `build:<number>`).
 */

export const triageItems = pgTable(
  'triage_items',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TriageKind>().notNull(),
    key: text('key').notNull(),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    /** End of a timed snooze; null for "until next push", or when not snoozed. */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    snoozeKind: text('snooze_kind').$type<SnoozeKind>(),
    /** For "until next push": the team's newest build number when it was snoozed. */
    snoozedAfterBuild: integer('snoozed_after_build'),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('triage_items_key').on(t.teamId, t.kind, t.key),
    index('triage_items_assignee_idx').on(t.assigneeId),
    check('triage_items_kind_check', inList('kind', TRIAGE_KINDS)),
    check('triage_items_snooze_kind_check', inListOrNull('snooze_kind', SNOOZE_KINDS)),
  ],
)

/** The people who take turns being on triage, in order (see `rotationFor` in `@circi/core`). */
export const triageRotationMembers = pgTable(
  'triage_rotation_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
)
