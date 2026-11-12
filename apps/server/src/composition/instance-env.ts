import type { Config } from '@circi/config'
import { INSTANCE_LIMIT_DEFAULTS } from '@circi/core'
import type { InstanceConfig } from '@circi/services'

/**
 * The environment layer of the instance settings: what `loadConfig` read (a variable's value, or
 * its default when unset) and which variables were set. The dashboard's saved values sit under the
 * set ones and over the defaults (`createInstanceConfig`).
 */
export function instanceEnvOf(config: Config): InstanceConfig.Env {
  return {
    locked: config.lockedSettings,
    workspaceCreation: config.workspaceCreation,
    signIn: { password: config.passwordLogin, email: config.emailEnabled, sso: config.ssoEnabled },
    limits: {
      defaultProjectRetentionDays: INSTANCE_LIMIT_DEFAULTS.defaultProjectRetentionDays,
      gcGraceHours: config.gcGraceHours,
      uploadTimeoutMinutes: config.uploadTimeoutMinutes,
      jobRetentionDays: config.jobRetentionDays,
      staticSitesMaxMb: config.staticSitesMaxMb,
      webhookTimeoutSeconds: config.webhookTimeoutMs / 1000,
    },
    ...(config.smtp ? { smtp: config.smtp } : {}),
    ...(config.slack ? { slack: config.slack } : {}),
    sso: config.sso,
  }
}
