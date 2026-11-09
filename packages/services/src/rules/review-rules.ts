import { type Database } from '@circi/db'
import { type ReviewRuleRow } from '@circi/db/queries'
import {
  createReviewRule,
  deleteReviewRule,
  reorderReviewRules,
  updateReviewRule,
} from '@circi/db/repositories'

/** Adds a rule at the end of the team's list; reviewers must belong to the team's workspace. */
export async function addReviewRule(
  db: Database,
  input: createReviewRule.Input,
): Promise<ReviewRuleRow> {
  return db.transaction((tx) => createReviewRule(tx, input))
}

/** Replaces a rule's kind, pattern and reviewers (its place in the order stays). */
export async function editReviewRule(
  db: Database,
  input: updateReviewRule.Input,
): Promise<ReviewRuleRow> {
  return db.transaction((tx) => updateReviewRule(tx, input))
}

/** Removes one of the team's rules. */
export async function removeReviewRule(db: Database, teamId: string, id: string): Promise<void> {
  await db.transaction((tx) => deleteReviewRule(tx, teamId, id))
}

/** Puts the team's rules in the given order (every rule exactly once); the first match wins. */
export async function orderReviewRules(
  db: Database,
  teamId: string,
  ruleIds: readonly string[],
): Promise<ReviewRuleRow[]> {
  return db.transaction((tx) => reorderReviewRules(tx, teamId, ruleIds))
}
