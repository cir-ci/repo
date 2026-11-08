import type { Inbox, Insights, ReviewRule, ReviewRuleKind, Triage } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '#lib/http.ts'

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

/** "Alice", "Alice and Bob", "Alice, Bob and 2 others". */
export function reviewerNames(rule: Pick<ReviewRule.Item, 'reviewers'>): string {
  const names = rule.reviewers.map((r) => r.name)
  if (names.length === 0) return 'No reviewers'
  if (names.length <= 2) return names.join(' and ')
  const others = names.length - 2
  return `${names.slice(0, 2).join(', ')} and ${others} other${others === 1 ? '' : 's'}`
}

export const rulesQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: ['rules', org, project],
    queryFn: () => getJson<ReviewRule.Settings>(`/api/projects/${seg(org)}/${seg(project)}/rules`),
  })

export function useRuleActions(org: string, project: string) {
  const queryClient = useQueryClient()
  const base = `/api/projects/${seg(org)}/${seg(project)}`
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rules', org, project] }),
      queryClient.invalidateQueries({ queryKey: ['triage', org, project] }),
    ])
  return {
    create: useMutation({
      mutationFn: (draft: RuleDraft) => post<unknown>(`${base}/rules`, ruleBody(draft)),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; draft: RuleDraft }) =>
        send<unknown>('PUT', `${base}/rules/${seg(input.id)}`, ruleBody(input.draft)),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => send<void>('DELETE', `${base}/rules/${seg(id)}`),
      onSuccess: refresh,
    }),
    rotation: useMutation({
      mutationFn: (body: ReturnType<typeof rotationBody>) =>
        send<Triage.Rotation>('PUT', `${base}/triage-rotation`, body),
      onSuccess: refresh,
    }),
  }
}

// ---- Review target ----------------------------------------------------------------------------

/** Why the hours can't be saved, or null. The server wants a whole number, at least 1. */
export function targetProblem(text: string): string | null {
  const t = text.trim()
  if (!/^\d+$/.test(t) || Number(t) < 1) return 'Enter a whole number of hours, at least 1'
  if (Number(t) > 24 * 365) return 'Use at most one year (8760 hours)'
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

export function startDateProblem(date: string): string | null {
  if (date === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return 'Enter a valid date'
  }
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

// ---- Email preferences ------------------------------------------------------------------------

export const PREFERENCE_ROWS: readonly {
  key: keyof Inbox.Preferences
  label: string
  description: string
}[] = [
  {
    key: 'emailReviewRequested',
    label: 'Review requested',
    description: 'Email me when someone asks me to review a build.',
  },
  {
    key: 'emailReviewOverdue',
    label: 'Review overdue',
    description: 'Email me when a review I owe has waited past its target.',
  },
]

export const preferencesQuery = () =>
  queryOptions({
    queryKey: ['notification-preferences'],
    queryFn: () => getJson<Inbox.Preferences>('/api/inbox/preferences'),
  })

/**
 * Saves one preference the moment it flips: the switch moves at once, and goes back if the
 * server says no.
 */
export function useSetPreference() {
  const queryClient = useQueryClient()
  const key = preferencesQuery().queryKey
  return useMutation({
    mutationFn: (change: Partial<Inbox.Preferences>) =>
      send<Inbox.Preferences>('PUT', '/api/inbox/preferences', change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Inbox.Preferences>(key)
      if (previous) queryClient.setQueryData<Inbox.Preferences>(key, { ...previous, ...change })
      return { previous }
    },
    onError: (_error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

// ---- Storage ----------------------------------------------------------------------------------

export const storageQuery = (org: string) =>
  queryOptions({
    queryKey: ['org-storage', org],
    queryFn: () => getJson<Insights.Report>(`/api/orgs/${seg(org)}/insights`),
  })

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** "0 B", "1.5 MB", "230 KB": decimal units, one decimal below 10. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1)
  return `${text.replace(/\.0$/, '')} ${UNITS[unit]}`
}

/** The projects by size, biggest first, each with its share of the total (0 to 1). */
export function storageRows(storage: Insights.Storage) {
  return storage.projects
    .toSorted((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .map((p) =>
      Object.assign({}, p, { share: storage.totalBytes > 0 ? p.bytes / storage.totalBytes : 0 }),
    )
}
