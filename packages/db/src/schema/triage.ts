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

/**
 * The problems a project's triage queue holds right now: the derived part of the queue, kept as
 * rows so counting them (the sidebar, on every fetch) is an indexed count instead of a
 * recomputation over every default-branch build. `refreshTriageProblems` rewrites a project's
 * rows whenever something that can change them is written (a build completes, fails, is re-run or
 * expires, a review is recorded, the default branch or flaky threshold changes). Same `kind` and
 * `key` as `triage_items`, which holds what people did about each.
 */
export const triageProblems = pgTable(
  'triage_problems',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TriageKind>().notNull(),
    key: text('key').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.kind, t.key] }),
    check('triage_problems_kind_check', inList('kind', TRIAGE_KINDS)),
  ],
)

/**
 * The flaky screenshots a project has already been told about, by name. `triage_problems` rows come
 * and go with the bounded history window, so a name that leaves and returns would be announced
 * again; this row stays, and is what decides "new" (see `refreshTriageProblems`).
 */
export const flakyAnnounced = pgTable(
  'flaky_announced',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.key] })],
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
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('triage_rotation_members_user_idx').on(t.userId),
  ],
)
