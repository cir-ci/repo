import { asc, eq, inArray } from 'drizzle-orm'

import { type ReviewRuleKind, reviewRuleReviewers, reviewRules, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A project's review rules, as the settings page and the matcher read them. */

export interface ReviewRuleRow {
  id: string
  kind: ReviewRuleKind
  pattern: string
  position: number
  reviewers: { id: string; name: string }[]
}

/** A project's rules in the order they apply, each with its reviewers (by name). */
export async function listReviewRules(db: Database, projectId: string): Promise<ReviewRuleRow[]> {
  const rules = await db
    .select()
    .from(reviewRules)
    .where(eq(reviewRules.projectId, projectId))
    .orderBy(asc(reviewRules.position), asc(reviewRules.createdAt), asc(reviewRules.id))
  if (rules.length === 0) return []
  const links = await db
    .select({ ruleId: reviewRuleReviewers.ruleId, id: user.id, name: user.name })
    .from(reviewRuleReviewers)
    .innerJoin(user, eq(user.id, reviewRuleReviewers.userId))
    .where(
      inArray(
        reviewRuleReviewers.ruleId,
        rules.map((r) => r.id),
      ),
    )
    .orderBy(asc(reviewRuleReviewers.createdAt), asc(user.name), asc(user.id))
  return rules.map((r) => ({
    id: r.id,
    kind: r.kind,
    pattern: r.pattern,
    position: r.position,
    reviewers: links.filter((l) => l.ruleId === r.id).map((l) => ({ id: l.id, name: l.name })),
  }))
}
