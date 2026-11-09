import { valueOf, type FlakyChoice } from './flaky-setting.ts'

/** What the General form holds when it is sent. */
export interface SettingsFields {
  name: string
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
    name: fields.name,
    defaultBranch: fields.defaultBranch,
    diffThreshold: Number(fields.diffThresholdPercent) / 100,
    retentionDays: Number(fields.retentionDays),
    autoApproveDefaultBranch: fields.autoApprove,
    blockMergeOnChanges: fields.blockMerge,
    flakyBlocksMerge: valueOf(fields.flaky),
    ...(sitesConfigured ? { staticHostingEnabled: fields.hosting } : {}),
  }
}
