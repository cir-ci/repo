import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { user } from './auth.ts'
import { REVIEW_RULE_KINDS, type ReviewRuleKind } from './enums.ts'
import { projects } from './projects.ts'

/**
 * Who is asked to review a build, by what it contains: a rule matches a glob against the
 * project's snapshot names or against the build's name, and asks its reviewers. Rules are
 * resolved when a build's last shard arrives (`finalizeBuild`), in `position` order.
 */

export const reviewRules = pgTable(
  'review_rules',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ReviewRuleKind>().notNull(),
    /** A glob (`*`, `**`, `?`); see `globMatches` in `@circi/core`. */
    pattern: text('pattern').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_rules_project_idx').on(t.projectId, t.position),
    check('review_rules_kind_check', inList('kind', REVIEW_RULE_KINDS)),
    check('review_rules_pattern_check', sql`length(btrim(${t.pattern})) > 0`),
  ],
)

export const reviewRuleReviewers = pgTable(
  'review_rule_reviewers',
  {
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => reviewRules.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.ruleId, t.userId] }),
    index('review_rule_reviewers_user_idx').on(t.userId),
  ],
)
