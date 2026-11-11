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
import {
  ASSIGNMENT_SOURCES,
  type AssignmentSource,
  SNOOZE_KINDS,
  type SnoozeKind,
  TRIAGE_KINDS,
  type TriageKind,
} from './enums.ts'
import { projects } from './projects.ts'

/**
 * Triage: a project's queue of problems nobody has dealt with (flaky snapshots, missing
 * baselines, failed builds). The problems themselves are derived from builds when read
 * (`listTriage`); `triage_items` only holds what people did about them, keyed by what kind of
 * problem it is and which one (`key`: the snapshot name, or `build:<number>`).
 */

export const triageItems = pgTable(
  'triage_items',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TriageKind>().notNull(),
    key: text('key').notNull(),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    /**
     * Who chose the assignee: `auto` (the person on triage, by the project's setting) moves at the
     * rotation's handover; `manual` (a person assigned or unassigned it) stays as it is. Null:
     * nobody has decided, so the setting may assign it.
     */
    assignmentSource: text('assignment_source').$type<AssignmentSource>(),
    /** End of a timed snooze; null for "until next push", or when not snoozed. */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    snoozeKind: text('snooze_kind').$type<SnoozeKind>(),
    /** For "until next push": the project's newest build number when it was snoozed. */
    snoozedAfterBuild: integer('snoozed_after_build'),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('triage_items_key').on(t.projectId, t.kind, t.key),
    index('triage_items_assignee_idx').on(t.assigneeId),
    check('triage_items_kind_check', inList('kind', TRIAGE_KINDS)),
    check(
      'triage_items_assignment_source_check',
      inListOrNull('assignment_source', ASSIGNMENT_SOURCES),
    ),
    check('triage_items_snooze_kind_check', inListOrNull('snooze_kind', SNOOZE_KINDS)),
  ],
)

/** The people who take turns being on triage, in order (see `rotationFor` in `@circi/core`). */
export const triageRotationMembers = pgTable(
  'triage_rotation_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
)
