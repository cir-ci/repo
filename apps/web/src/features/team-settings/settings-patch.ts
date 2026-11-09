import { isValidSlug } from '@circi/core'

import { valueOf, type FlakyChoice } from './flaky-setting.ts'

/** The server's bounds (retention in days, review target in hours). */
export const RETENTION_DAYS_MAX = 3650
export const REVIEW_TARGET_HOURS_MAX = 720

/** The fields of the General form that can be wrong, named as the server names them. */
export const SETTINGS_FIELDS = ['slug', 'defaultBranch', 'diffThreshold', 'retentionDays'] as const
export type SettingsField = (typeof SETTINGS_FIELDS)[number]

/**
 * What is wrong with the form before it is sent, by field: the diff threshold is a percentage from
 * 0 to 100, retention a whole number of days from 1 to 3650.
 */
export function settingsProblems(
  fields: Pick<SettingsFields, 'slug' | 'defaultBranch' | 'diffThresholdPercent' | 'retentionDays'>,
  /** The saved address: an old one that no longer passes the rules is left alone until edited. */
  savedSlug = '',
): Partial<Record<SettingsField, string>> {
  const problems: Partial<Record<SettingsField, string>> = {}
  const slug = fields.slug.trim()
  if (!slug) problems.slug = 'Enter an address'
  else if (slug !== savedSlug && !isValidSlug(slug)) {
    problems.slug =
      'Use up to 40 lowercase letters, digits or single hyphens, not starting or ending with a hyphen'
  }
  if (!fields.defaultBranch.trim()) problems.defaultBranch = 'Enter a branch name'
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

/** What the General form holds when it is sent (the name saves by itself, elsewhere). */
export interface SettingsFields {
  slug: string
  defaultBranch: string
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
    slug: fields.slug,
    defaultBranch: fields.defaultBranch,
    diffThreshold: Number(fields.diffThresholdPercent) / 100,
    retentionDays: Number(fields.retentionDays),
    autoApproveDefaultBranch: fields.autoApprove,
    blockMergeOnChanges: fields.blockMerge,
    flakyBlocksMerge: valueOf(fields.flaky),
    ...(sitesConfigured ? { staticHostingEnabled: fields.hosting } : {}),
  }
}
