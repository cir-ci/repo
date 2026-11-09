import type { ReviewRule, ReviewRuleKind, Triage } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { REVIEW_TARGET_HOURS_MAX } from '#features/team-settings/settings-patch.ts'
import { teamPath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

// ---- Review rules -----------------------------------------------------------------------------

export const MAX_PATTERN_LENGTH = 200
export const MAX_REVIEWERS = 20

export const RULE_KINDS: readonly { value: ReviewRuleKind; label: string }[] = [
  { value: 'snapshot-name', label: 'Snapshot name' },
  { value: 'build-name', label: 'Build name' },
]

export const isRuleKind = (value: string): value is ReviewRuleKind =>
  value === 'snapshot-name' || value === 'build-name'

export const kindLabel = (kind: ReviewRuleKind) =>
  RULE_KINDS.find((k) => k.value === kind)?.label ?? kind

/** What a person is editing: one rule, before it is saved. */
export interface RuleDraft {
  kind: ReviewRuleKind
  pattern: string
  reviewerIds: string[]
}

export const emptyDraft = (): RuleDraft => ({
  kind: 'snapshot-name',
  pattern: '',
  reviewerIds: [],
})

export const draftOf = (rule: ReviewRule.Item): RuleDraft => ({
  kind: rule.kind,
  pattern: rule.pattern,
  reviewerIds: rule.reviewers.map((r) => r.id),
})

/** Why a glob can't be saved, or null. The server accepts any text up to 200 characters. */
export function patternProblem(pattern: string): string | null {
  const text = pattern.trim()
  if (!text) return 'Enter a pattern, like checkout/** or Button*'
  if (text.length > MAX_PATTERN_LENGTH) return `Use at most ${MAX_PATTERN_LENGTH} characters`
  if (/\*{3,}/.test(text)) return 'Use * within a name or ** across folders, not three stars'
  return null
}

/** Why a rule can't be saved, or null. */
export function draftProblem(draft: RuleDraft): string | null {
  const pattern = patternProblem(draft.pattern)
  if (pattern) return pattern
  if (draft.reviewerIds.length === 0) return 'Choose at least one reviewer'
  if (draft.reviewerIds.length > MAX_REVIEWERS) return `Choose at most ${MAX_REVIEWERS} reviewers`
  return null
}

/** The request body for creating or replacing a rule. */
export const ruleBody = (draft: RuleDraft) => ({
  kind: draft.kind,
  pattern: draft.pattern.trim(),
  reviewerIds: draft.reviewerIds,
})

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

export const ruleDirty = (rule: ReviewRule.Item, draft: RuleDraft) =>
  rule.kind !== draft.kind ||
  rule.pattern !== draft.pattern.trim() ||
  !sameSet(
    rule.reviewers.map((r) => r.id),
    draft.reviewerIds,
  )

/**
 * The rule ids with one moved a place up (`-1`) or down (`1`); null when it can't move that way.
 * First match wins, so this is the order the server stores.
 */
export function movedRuleIds(
  rules: readonly Pick<ReviewRule.Item, 'id'>[],
  id: string,
  by: -1 | 1,
): string[] | null {
  const ids = rules.map((r) => r.id)
  const from = ids.indexOf(id)
  const to = from + by
  if (from < 0 || to < 0 || to >= ids.length) return null
  const [moved] = ids.splice(from, 1)
  if (moved === undefined) return null
  ids.splice(to, 0, moved)
  return ids
}

/** "Alice", "Alice and Bob", "Alice, Bob and 2 others". */
export function reviewerNames(rule: Pick<ReviewRule.Item, 'reviewers'>): string {
  const names = rule.reviewers.map((r) => r.name)
  if (names.length === 0) return 'No reviewers'
  if (names.length <= 2) return names.join(' and ')
  const others = names.length - 2
  return `${names.slice(0, 2).join(', ')} and ${others} other${others === 1 ? '' : 's'}`
}

export const rulesQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.rules(workspace, team),
    queryFn: () => getJson<ReviewRule.Settings>(teamPath(workspace, team, 'rules')),
  })

export function useRuleActions(workspace: string, team: string) {
  const queryClient = useQueryClient()
  const base = (...rest: string[]) => teamPath(workspace, team, ...rest)
  const refresh = () =>
    invalidateAll(queryClient, keys.rules(workspace, team), keys.triage(workspace, team))
  return {
    create: useMutation({
      mutationFn: (draft: RuleDraft) => post<unknown>(base('rules'), ruleBody(draft)),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; draft: RuleDraft }) =>
        send<unknown>('PUT', base('rules', input.id), ruleBody(input.draft)),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => send<void>('DELETE', base('rules', id)),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: (ruleIds: string[]) => send<unknown>('PUT', base('rules', 'order'), { ruleIds }),
      onSuccess: refresh,
    }),
    rotation: useMutation({
      mutationFn: (body: ReturnType<typeof rotationBody>) =>
        send<Triage.Rotation>('PUT', base('triage-rotation'), body),
      onSuccess: refresh,
    }),
  }
}

// ---- Review target ----------------------------------------------------------------------------

/** Why the hours can't be saved, or null. The server wants a whole number from 1 to 720 (30 days). */
export function targetProblem(text: string): string | null {
  const t = text.trim()
  if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > REVIEW_TARGET_HOURS_MAX) {
    return `Enter a whole number of hours from 1 to ${REVIEW_TARGET_HOURS_MAX}`
  }
  return null
}

/** The value to save: null for "no target". */
export const targetValue = (enabled: boolean, text: string): number | null =>
  enabled ? Number(text.trim()) : null

export const targetText = (saved: number | null, fallback = 24) => String(saved ?? fallback)

export const targetDirty = (saved: number | null, enabled: boolean, text: string) =>
  enabled ? saved !== Number(text.trim()) : saved !== null

/** "1 day", "36 hours": the target in words. */
export function describeHours(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

// ---- Triage rotation --------------------------------------------------------------------------

/** The date input's value for a saved start: "2026-11-02", or "" without a rotation. */
export const startDateOf = (rotation: Triage.Rotation) => rotation.startsOn?.slice(0, 10) ?? ''

/** Whether "2026-02-31" names a day that exists (the date parser rolls it over to March). */
export function isCalendarDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return false
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(Date.UTC(year, month - 1, day))
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
}

/**
 * Why the start date can't be used, or null. `unreadable` is the date input saying that what is
 * typed in it is not a date (its value is then empty, which must not pass for "start now").
 */
export function startDateProblem(date: string, unreadable = false): string | null {
  if (unreadable) return 'Enter a valid date'
  if (date === '') return null
  if (!isCalendarDate(date)) return 'Enter a valid date'
  return null
}

/** The request body: an empty member list turns the rotation off; no date means "starting now". */
export function rotationBody(memberIds: readonly string[], startDate: string) {
  return {
    memberIds: [...memberIds],
    ...(memberIds.length > 0 && startDate !== '' ? { startsOn: `${startDate}T00:00:00.000Z` } : {}),
  }
}

export function rotationDirty(
  saved: Triage.Rotation,
  memberIds: readonly string[],
  startDate: string,
): boolean {
  const savedIds = saved.members.map((m) => m.id)
  // The order is the turn order, so it counts.
  if (savedIds.length !== memberIds.length || savedIds.some((id, i) => id !== memberIds[i])) {
    return true
  }
  return memberIds.length > 0 && startDate !== '' && startDate !== startDateOf(saved)
}

/** Toggles a member, keeping the others' order and adding new ones at the end. */
export const toggleMember = (ids: readonly string[], id: string, on: boolean) =>
  on ? (ids.includes(id) ? [...ids] : [...ids, id]) : ids.filter((x) => x !== id)
