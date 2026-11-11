import { isValidSlug } from '@circi/core'

import { valueOf, type FlakyChoice } from './flaky-setting.ts'

/** The server's bounds (retention in days, review target in hours). */
export const RETENTION_DAYS_MAX = 3650
export const REVIEW_TARGET_HOURS_MAX = 720

/** The fields of the General form that can be wrong, named as the server names them. */
export const SETTINGS_FIELDS = ['diffThreshold', 'retentionDays'] as const
export type SettingsField = (typeof SETTINGS_FIELDS)[number]

/** What is wrong with a project's address, or null. */
export function slugProblem(
  value: string,
  /** The saved address: an old one that no longer passes the rules is left alone until edited. */
  savedSlug = '',
): string | null {
  const slug = value.trim()
  if (!slug) return 'Enter an address'
  if (slug !== savedSlug && !isValidSlug(slug)) {
    return 'Use up to 40 lowercase letters, digits or single hyphens, not starting or ending with a hyphen'
  }
  return null
}

/** What is wrong with a default branch name, or null. */
export function branchProblem(value: string): string | null {
  return value.trim() ? null : 'Enter a branch name'
}

/**
 * What is wrong with the form before it is sent, by field: the diff threshold is a percentage from
 * 0 to 100, retention a whole number of days from 1 to 3650.
 */
export function settingsProblems(
  fields: Pick<SettingsFields, 'diffThresholdPercent' | 'retentionDays'>,
): Partial<Record<SettingsField, string>> {
  const problems: Partial<Record<SettingsField, string>> = {}
  const threshold = fields.diffThresholdPercent.trim()
  if (
    threshold === '' ||
    !Number.isFinite(Number(threshold)) ||
    Number(threshold) < 0 ||
    Number(threshold) > 100
  ) {
    problems.diffThreshold = 'Enter a percentage from 0 to 100'
  }
  const days = fields.retentionDays.trim()
  if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > RETENTION_DAYS_MAX) {
    problems.retentionDays = `Enter a whole number of days from 1 to ${RETENTION_DAYS_MAX}`
  }
  return problems
}

/** What the General form holds when it is sent (the name, address and default branch save by themselves, elsewhere). */
export interface SettingsFields {
  /** As typed, in percent. */
  diffThresholdPercent: string
  retentionDays: string
  autoApprove: boolean
  blockMerge: boolean
  flaky: FlakyChoice
  hosting: boolean
}

/** The body of `PATCH …/settings`; the hosting setting is left out when the instance can't host. */
export function buildSettingsPatch(fields: SettingsFields, sitesConfigured: boolean) {
  return {
    diffThreshold: Number(fields.diffThresholdPercent) / 100,
    retentionDays: Number(fields.retentionDays),
    autoApproveDefaultBranch: fields.autoApprove,
    blockMergeOnChanges: fields.blockMerge,
    flakyBlocksMerge: valueOf(fields.flaky),
    ...(sitesConfigured ? { staticHostingEnabled: fields.hosting } : {}),
  }
}
