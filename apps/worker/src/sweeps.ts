import { autoAssignAllTeams, expireStalledBuilds, runRetention } from '@circi/services'

import { reviewSweep } from './jobs/review-sweep.ts'
import type { startWorker } from './runner.ts'

/** Runs `task` every `everyMs` (0 turns it off) without keeping the process alive; returns the timer. */
function every(everyMs: number, task: () => void): NodeJS.Timeout | undefined {
  if (everyMs <= 0) return undefined
  const timer = setInterval(task, everyMs)
  timer.unref()
  return timer
}

/**
 * The interval-based sweeps: builds that stopped uploading are failed, retention expires old
 * builds and collects files, overdue review requests are announced. Returns the function that
 * stops them.
 */
export function startSweeps(deps: startWorker.Deps): () => void {
  const { db, logger } = deps
  const timeoutMinutes = deps.uploadTimeoutMinutes ?? 60
  const timers = [
    every(timeoutMinutes > 0 ? (deps.maintenanceIntervalMs ?? 5 * 60_000) : 0, () => {
      expireStalledBuilds(db, new Date(Date.now() - timeoutMinutes * 60_000)).then(
        (n) => {
          if (n > 0) logger.warn({ builds: n }, 'failed builds that stopped uploading')
        },
        (err: unknown) => logger.error({ err }, 'could not expire stalled builds'),
      )
    }),
    every(deps.retentionIntervalMs ?? 6 * 3600_000, () => {
      runRetention(db, {
        graceMs: (deps.gcGraceHours ?? 24) * 3600_000,
        deleteObject: (key) => deps.storage.delete(key),
      }).then(
        (r) => logger.info(r, 'retention pass finished'),
        (err: unknown) => logger.error({ err }, 'retention pass failed'),
      )
    }),
    every(deps.reviewSweepIntervalMs ?? 5 * 60_000, () => {
      reviewSweep({ db }).then(
        (n) => {
          if (n > 0) logger.info({ reviewers: n }, 'told reviewers about overdue requests')
        },
        (err: unknown) => logger.error({ err }, 'review sweep failed'),
      )
    }),
    // The handover (Mondays) and snoozes that ended: items nobody has go to the person on triage.
    every(deps.triageAssignIntervalMs ?? 5 * 60_000, () => {
      autoAssignAllTeams(db).then(
        (n) => {
          if (n > 0) logger.info({ items: n }, 'assigned triage items to whoever is on triage')
        },
        (err: unknown) => logger.error({ err }, 'triage auto-assignment failed'),
      )
    }),
  ]
  return () => timers.forEach((t) => t && clearInterval(t))
}
