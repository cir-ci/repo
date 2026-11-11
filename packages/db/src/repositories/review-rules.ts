import { RULE_KINDS, ValidationError, assertFound } from '@circi/core'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { listReviewRules, type ReviewRuleRow } from '#queries/review-rules.ts'
import {
  member,
  projectMembers,
  projects,
  reviewRuleReviewers,
  reviewRules,
  type ReviewRuleKind,
  screenshots,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Review rules: which glob of snapshot or build names asks which people to review. Data only;
 * turning a matching rule into review requests is `finalizeBuild` in `@circi/services`.
 */

const MAX_PATTERN = 200
const MAX_REVIEWERS = 20

async function assertMembers(db: Database, projectId: string, userIds: string[]): Promise<void> {
  const found = await db
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, userIds)))
  if (new Set(found.map((r) => r.id)).size !== userIds.length) {
    throw new ValidationError('Reviewers must be members of this project')
  }
}

function checkInput(input: { kind: string; pattern: string; reviewerIds: string[] }): {
  kind: ReviewRuleKind
  pattern: string
  reviewerIds: string[]
} {
  const kind = RULE_KINDS.find((k) => k === input.kind)
  if (!kind) throw new ValidationError(`Unknown rule kind "${input.kind}"`)
  const pattern = input.pattern.trim()
  if (!pattern) throw new ValidationError('A pattern is required')
  if (pattern.length > MAX_PATTERN) throw new ValidationError('That pattern is too long')
  const reviewerIds = [...new Set(input.reviewerIds)]
  if (reviewerIds.length === 0) throw new ValidationError('Choose at least one reviewer')
  if (reviewerIds.length > MAX_REVIEWERS) throw new ValidationError('That is too many reviewers')
  return { kind, pattern, reviewerIds }
}

/**
 * The rules to apply to a new build: like `listReviewRules`, but only reviewers who are still
 * members of the project (someone removed from it can't be asked), as ids.
 */
export async function listRulesForResolution(
  db: Database,
  projectId: string,
): Promise<{ kind: ReviewRuleKind; pattern: string; reviewers: string[] }[]> {
  const rules = await listReviewRules(db, projectId)
  if (rules.length === 0) return []
  const current = await db
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(
      member,
      and(eq(member.workspaceId, projects.workspaceId), eq(member.userId, projectMembers.userId)),
    )
    .where(eq(projectMembers.projectId, projectId))
  const ok = new Set(current.map((r) => r.id))
  return rules.map((r) => ({
    kind: r.kind,
    pattern: r.pattern,
    reviewers: r.reviewers.map((x) => x.id).filter((id) => ok.has(id)),
  }))
}

/** The names of a build's screenshots. */
export async function listScreenshotNames(db: Database, buildId: string): Promise<string[]> {
  const rows = await db
    .select({ name: screenshots.name })
    .from(screenshots)
    .where(eq(screenshots.buildId, buildId))
    .orderBy(asc(screenshots.name))
  return rows.map((r) => r.name)
}

/** Adds a rule after the project's others. */
export async function createReviewRule(
  db: Database,
  input: createReviewRule.Input,
): Promise<ReviewRuleRow> {
  const { kind, pattern, reviewerIds } = checkInput(input)
  await assertMembers(db, input.projectId, reviewerIds)
  const id = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${reviewRules.position}), -1)` })
      .from(reviewRules)
      .where(eq(reviewRules.projectId, input.projectId))
    const [rule] = await tx
      .insert(reviewRules)
      .values({ projectId: input.projectId, kind, pattern, position: (last?.max ?? -1) + 1 })
      .returning({ id: reviewRules.id })
    if (!rule) throw new Error('insert returned no row')
    await tx
      .insert(reviewRuleReviewers)
      .values(reviewerIds.map((userId) => ({ ruleId: rule.id, userId })))
    return rule.id
  })
  const created = (await listReviewRules(db, input.projectId)).find((r) => r.id === id)
  if (!created) throw new Error('review rule vanished')
  return created
}
export namespace createReviewRule {
  export interface Input {
    projectId: string
    kind: string
    pattern: string
    reviewerIds: string[]
  }
}

/** Replaces a rule's kind, pattern and reviewers; its place in the order stays. */
export async function updateReviewRule(
  db: Database,
  input: updateReviewRule.Input,
): Promise<ReviewRuleRow> {
  const { kind, pattern, reviewerIds } = checkInput(input)
  await assertMembers(db, input.projectId, reviewerIds)
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(reviewRules)
      .set({ kind, pattern })
      .where(and(eq(reviewRules.id, input.id), eq(reviewRules.projectId, input.projectId)))
      .returning({ id: reviewRules.id })
    assertFound(rows[0], 'Review rule not found')
    await tx.delete(reviewRuleReviewers).where(eq(reviewRuleReviewers.ruleId, input.id))
    await tx
      .insert(reviewRuleReviewers)
      .values(reviewerIds.map((userId) => ({ ruleId: input.id, userId })))
  })
  const updated = (await listReviewRules(db, input.projectId)).find((r) => r.id === input.id)
  if (!updated) throw new Error('review rule vanished')
  return updated
}
export namespace updateReviewRule {
  export interface Input extends createReviewRule.Input {
    id: string
  }
}

export async function deleteReviewRule(db: Database, projectId: string, id: string): Promise<void> {
  const rows = await db
    .delete(reviewRules)
    .where(and(eq(reviewRules.id, id), eq(reviewRules.projectId, projectId)))
    .returning({ id: reviewRules.id })
  assertFound(rows[0], 'Review rule not found')
}

/**
 * Puts a project's rules in the given order (first match wins, so the order matters). The list
 * must name every rule of the project exactly once; otherwise nothing changes. One statement per
 * rule inside one transaction, so a reader never sees a half-moved list.
 */
export async function reorderReviewRules(
  db: Database,
  projectId: string,
  ruleIds: readonly string[],
): Promise<ReviewRuleRow[]> {
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: reviewRules.id })
      .from(reviewRules)
      .where(eq(reviewRules.projectId, projectId))
      .for('update')
    const known = new Set(current.map((r) => r.id))
    if (
      new Set(ruleIds).size !== ruleIds.length ||
      ruleIds.length !== known.size ||
      !ruleIds.every((id) => known.has(id))
    ) {
      throw new ValidationError('Give every review rule of the project exactly once')
    }
    for (const [position, id] of ruleIds.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- a project has a handful of rules
      await tx
        .update(reviewRules)
        .set({ position })
        .where(and(eq(reviewRules.id, id), eq(reviewRules.projectId, projectId)))
    }
  })
  return listReviewRules(db, projectId)
}
