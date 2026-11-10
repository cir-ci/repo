import type { ReviewRule, ReviewRuleKind, Team, Triage } from '@circi/api'
import { MAX_FLAKY_FLIP_FLOPS, MIN_FLAKY_FLIP_FLOPS, reviewDueAt } from '@circi/core'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { choiceOf, type FlakyChoice, valueOf } from '#features/team-settings/flaky-setting.ts'
import { REVIEW_TARGET_HOURS_MAX } from '#features/team-settings/settings-patch.ts'
import { teamPath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

// ---- Review rules -----------------------------------------------------------------------------

export const MAX_PATTERN_LENGTH = 200
export const MAX_REVIEWERS = 20

export const RULE_KINDS: readonly { value: ReviewRuleKind; label: string }[] = [
  { value: 'snapshot-name', label: 'Screenshot name' },
  { value: 'build-name', label: 'Build name' },
]

export const isRuleKind = (value: string): value is ReviewRuleKind =>
  value === 'snapshot-name' || value === 'build-name'

export const kindLabel = (kind: ReviewRuleKind) =>
  RULE_KINDS.find((k) => k.value === kind)?.label ?? kind

/** A team member, as the pickers and avatars need them. */
export interface Person {
  id: string
  name: string
  image?: string | null
}

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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The board's example for the target: a request made Friday 16:00 is overdue on the day (and hour)
 * that many working hours later, weekends not counted. Null for hours that aren't a valid target.
 */
export function overdueExample(hours: string): string | null {
  if (targetProblem(hours) !== null) return null
  // 2026-01-02 is a Friday; the example only needs the weekday and the hour.
  const made = new Date('2026-01-02T16:00:00.000Z')
  const due = reviewDueAt(made, Number(hours.trim()))
  if (!due) return null
  const clock = `${String(due.getUTCHours()).padStart(2, '0')}:${String(due.getUTCMinutes()).padStart(2, '0')}`
  return `Example: a request made Friday 16:00 becomes overdue ${WEEKDAYS[due.getUTCDay()]} ${clock}.`
}

// ---- The other settings -----------------------------------------------------------------------

/** How many days a snoozed item stays away, as the select offers them. */
export const SNOOZE_DAY_CHOICES = [1, 3, 7, 14, 30] as const

export const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`

/** Why the flaky threshold can't be saved, or null. */
export function flakyProblem(text: string): string | null {
  const t = text.trim()
  if (!/^\d+$/.test(t) || Number(t) < MIN_FLAKY_FLIP_FLOPS || Number(t) > MAX_FLAKY_FLIP_FLOPS) {
    return `Enter a whole number from ${MIN_FLAKY_FLIP_FLOPS} to ${MAX_FLAKY_FLIP_FLOPS}`
  }
  return null
}

/** Everything the Save below the rules sends, as the form holds it (numbers as typed). */
export interface FormValues {
  /** Empty: no review target. */
  hours: string
  /** The member also told when a request misses its target; '' for nobody. */
  notifyUserId: string
  close: boolean
  reRequest: boolean
  autoApprove: boolean
  requireReason: boolean
  flakyAfter: string
  snoozeDays: string
  /** Whether new triage items go to whoever is on triage; `inherit` follows the workspace. */
  assignOnCall: FlakyChoice
  rotationIds: string[]
  rotationDate: string
}

export type SavedSettings = Pick<
  Team.Settings,
  | 'reviewTargetHours'
  | 'reviewOverdueNotifyUserId'
  | 'closeReviewsOnNewerBuild'
  | 'reRequestOnNewerBuild'
  | 'autoApproveNoChanges'
  | 'requireRejectReason'
  | 'flakyAfterChanges'
  | 'snoozeDefaultDays'
  | 'assignTriageToOnCall'
>

export const formValuesOf = (settings: SavedSettings, rotation: Triage.Rotation): FormValues => ({
  hours: settings.reviewTargetHours === null ? '' : String(settings.reviewTargetHours),
  notifyUserId: settings.reviewOverdueNotifyUserId ?? '',
  close: settings.closeReviewsOnNewerBuild,
  reRequest: settings.reRequestOnNewerBuild,
  autoApprove: settings.autoApproveNoChanges,
  requireReason: settings.requireRejectReason,
  flakyAfter: String(settings.flakyAfterChanges),
  snoozeDays: String(settings.snoozeDefaultDays),
  assignOnCall: choiceOf(settings.assignTriageToOnCall),
  rotationIds: rotation.members.map((m) => m.id),
  rotationDate: startDateOf(rotation),
})

/** The settings that differ from what is saved, as the PATCH body (empty: nothing to send). */
export function settingsPatch(saved: SavedSettings, v: FormValues): Partial<Team.Settings> {
  const patch: Partial<Team.Settings> = {}
  const hours = v.hours.trim() === '' ? null : Number(v.hours.trim())
  if (hours !== saved.reviewTargetHours) patch.reviewTargetHours = hours
  const notify = v.notifyUserId === '' ? null : v.notifyUserId
  if (notify !== saved.reviewOverdueNotifyUserId) patch.reviewOverdueNotifyUserId = notify
  if (v.close !== saved.closeReviewsOnNewerBuild) patch.closeReviewsOnNewerBuild = v.close
  if (v.reRequest !== saved.reRequestOnNewerBuild) patch.reRequestOnNewerBuild = v.reRequest
  if (v.autoApprove !== saved.autoApproveNoChanges) patch.autoApproveNoChanges = v.autoApprove
  if (v.requireReason !== saved.requireRejectReason) patch.requireRejectReason = v.requireReason
  if (Number(v.flakyAfter) !== saved.flakyAfterChanges) {
    patch.flakyAfterChanges = Number(v.flakyAfter)
  }
  if (Number(v.snoozeDays) !== saved.snoozeDefaultDays) {
    patch.snoozeDefaultDays = Number(v.snoozeDays)
  }
  if (v.assignOnCall !== choiceOf(saved.assignTriageToOnCall)) {
    patch.assignTriageToOnCall = valueOf(v.assignOnCall)
  }
  return patch
}

/** What blocks Save, by field. */
export function formProblems(v: FormValues): { hours?: string; flakyAfter?: string } {
  const hours = v.hours.trim() === '' ? null : targetProblem(v.hours)
  const flaky = flakyProblem(v.flakyAfter)
  return { ...(hours ? { hours } : {}), ...(flaky ? { flakyAfter: flaky } : {}) }
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
