import type { Database } from '@circi/db'
import {
  autoAssignAllProjects,
  expireStalledBuilds,
  pruneFinishedJobs,
  runExclusive,
  runRetention,
} from '@circi/services'

import { reviewSweep } from './jobs/review-sweep.ts'
import { currentLimits } from './limits.ts'
import { giveUpExpiredJobs } from './run-job.ts'
import type { startWorker } from './runner.ts'

/**
 * Wraps a sweep so that it runs once at a time across all worker processes: a pass that starts
 * while the previous one of this process is still going is skipped, and so is one whose
 * Postgres try-lock another process holds. The lock is held on its own connection, so `task` runs
 * on the normal database with its own short transactions.
 * Resolves to whether the pass ran.
 */
export function exclusiveSweep(
  db: Database,
  name: string,
  task: () => Promise<void>,
): () => Promise<boolean> {
  let busy = false
  return async () => {
    if (busy) return false
    busy = true
    try {
      return (await runExclusive(db, name, task)).ran
    } finally {
      busy = false
    }
  }
}

/** Runs `pass` every `everyMs` (0 turns it off) without keeping the process alive; returns the timer. */
function every(everyMs: number, pass: () => Promise<boolean>, onError: (err: unknown) => void) {
  if (everyMs <= 0) return undefined
  const timer = setInterval(() => void pass().catch(onError), everyMs)
  timer.unref()
  return timer
}

/**
 * The interval-based sweeps: builds that stopped uploading are failed, retention expires old
 * builds and collects files, overdue review requests are announced, finished jobs are pruned.
 * Every worker process starts them, but each sweep runs on one process at a time (a Postgres
 * try-lock) and never overlaps itself. Returns the function that stops them.
 */
export function startSweeps(deps: startWorker.Deps): () => void {
  const { db, logger } = deps
  const limits = () => currentLimits(deps)
  const timers = [
    every(
      deps.maintenanceIntervalMs ?? 5 * 60_000,
      exclusiveSweep(db, 'stalled-builds', async () => {
        const timeoutMinutes = (await limits()).uploadTimeoutMinutes
        // 0 never times a build out.
        if (timeoutMinutes <= 0) return
        const n = await expireStalledBuilds(db, new Date(Date.now() - timeoutMinutes * 60_000))
        if (n > 0) logger.warn({ builds: n }, 'failed builds that stopped uploading')
      }),
      (err) => logger.error({ err }, 'could not expire stalled builds'),
    ),
    every(
      deps.retentionIntervalMs ?? 6 * 3600_000,
      exclusiveSweep(db, 'retention', async () => {
        const r = await runRetention(db, {
          graceMs: (await limits()).gcGraceHours * 3600_000,
          deleteObject: (key) => deps.storage.delete(key),
        })
        logger.info(r, 'retention pass finished')
      }),
      (err) => logger.error({ err }, 'retention pass failed'),
    ),
    every(
      deps.reviewSweepIntervalMs ?? 5 * 60_000,
      exclusiveSweep(db, 'review', async () => {
        const n = await reviewSweep({ db })
        if (n > 0) logger.info({ reviewers: n }, 'told reviewers about overdue requests')
      }),
      (err) => logger.error({ err }, 'review sweep failed'),
    ),
    // The handover (Mondays) and snoozes that ended: items nobody has go to the person on triage.
    every(
      deps.triageAssignIntervalMs ?? 5 * 60_000,
      exclusiveSweep(db, 'triage-assign', async () => {
        const n = await autoAssignAllProjects(db)
        if (n > 0) logger.info({ items: n }, 'assigned triage items to whoever is on triage')
      }),
      (err) => logger.error({ err }, 'triage auto-assignment failed'),
    ),
    // A job whose worker keeps dying is failed once its attempts are used, and gives up.
    every(
      deps.leaseSweepIntervalMs ?? 30_000,
      exclusiveSweep(db, 'expired-leases', async () => {
        const n = await giveUpExpiredJobs(deps)
        if (n > 0) logger.warn({ jobs: n }, 'failed jobs whose lease expired too many times')
      }),
      (err) => logger.error({ err }, 'could not fail expired jobs'),
    ),
    // Done and failed jobs are history nobody reads after a while; 0 days keeps them.
    every(
      deps.jobPruneIntervalMs ?? 3600_000,
      exclusiveSweep(db, 'prune-jobs', async () => {
        const jobRetentionDays = (await limits()).jobRetentionDays
        // 0 keeps finished jobs.
        if (jobRetentionDays <= 0) return
        const n = await pruneFinishedJobs(db, { olderThanDays: jobRetentionDays })
        if (n > 0) logger.info({ jobs: n }, 'deleted finished jobs')
      }),
      (err) => logger.error({ err }, 'could not prune finished jobs'),
    ),
  ]
  return () => timers.forEach((t) => t && clearInterval(t))
}
