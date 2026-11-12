import type { startWorker } from './runner.ts'

/** The limits in force now: read from the instance settings when the worker was given them, else the plain values. */
export async function currentLimits(
  deps: Pick<
    startWorker.Deps,
    'limits' | 'uploadTimeoutMinutes' | 'gcGraceHours' | 'jobRetentionDays' | 'webhookTimeoutMs'
  >,
): Promise<startWorker.Limits> {
  if (deps.limits) return deps.limits()
  return {
    uploadTimeoutMinutes: deps.uploadTimeoutMinutes ?? 60,
    gcGraceHours: deps.gcGraceHours ?? 24,
    jobRetentionDays: deps.jobRetentionDays ?? 14,
    // 0: the delivery's own default.
    webhookTimeoutMs: deps.webhookTimeoutMs ?? 0,
  }
}
