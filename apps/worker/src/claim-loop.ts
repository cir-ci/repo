import { claimNextJob, nextJobDueInMs } from '@circi/services'

import { interruptibleSleep } from './lib/concurrency.ts'
import { startListening } from './listen.ts'
import { runJob } from './run-job.ts'
import type { startWorker } from './runner.ts'

/** The poll, or less when a pending job falls due sooner (a little past it: the database's clock decides). */
async function idleWaitMs(deps: startWorker.Deps, light: boolean, pollMs: number): Promise<number> {
  const due = await nextJobDueInMs(deps.db, { light }).catch(() => undefined)
  return due === undefined ? pollMs : Math.min(pollMs, Math.max(50, due + 25))
}

/**
 * The poll lanes (`concurrency` that take builds first, plus `lightLanes` that never take one): each claims one job at a time (`FOR UPDATE SKIP LOCKED`, so several worker
 * processes can share a database), runs it, and sleeps when the queue is empty. A NOTIFY wakes all
 * lanes at once; the poll interval is the fallback for missed notifications. An idle lane sleeps
 * until the earliest pending `run_at` it can see when that is sooner than the poll, so a retry or a
 * delayed job runs at its time. Enqueueing a delayed job and retrying a failed one send a NOTIFY,
 * so an idle worker process learns of it at once and sets that sleep; the one limit left is a
 * worker with no listener connection (it sees such a job at its next poll).
 */
export function startLanes(deps: startWorker.Deps): { stop(): Promise<void> } {
  // NOTIFY wakes the lanes at once, so with a listener the poll is only the fallback (missed
  // notifications, another worker's retries that fall due): a longer wait keeps an idle worker nearly silent.
  const pollMs = deps.pollIntervalMs ?? (deps.listen ? 5_000 : 1_000)
  const lockSeconds = deps.lockSeconds ?? 600
  const buildLanes = deps.concurrency ?? 2
  // Lanes that never take a build, so a backlog of builds can't starve webhooks, git checks, email and Slack.
  const lightLanes = deps.lightLanes ?? 1
  const lanes = buildLanes + lightLanes
  // Flipped by stop(); a shared object so every lane sees the change.
  const state = { running: true }
  const sleepers = Array.from({ length: lanes }, () => interruptibleSleep())

  // A wake-up that arrives while a lane is busy (or between "found nothing" and "went to sleep")
  // is remembered per lane, so it is never lost; several before the lane looks count as one.
  const woken = sleepers.map(() => false)
  const wakeAll = () => {
    sleepers.forEach((s, i) => {
      woken[i] = true
      s.wake()
    })
  }
  // A retried job comes due after its backoff, and nothing notifies at that moment: this worker
  // sets a timer for it, so the retry waits its backoff and not up to a whole poll interval.
  const wakeTimers = new Set<NodeJS.Timeout>()
  const wakeAfter = (ms: number) => {
    // A little past the due time: the database's clock decides whether the job is due.
    const timer = setTimeout(() => {
      wakeTimers.delete(timer)
      if (state.running) wakeAll()
    }, ms + 25)
    timer.unref()
    wakeTimers.add(timer)
  }
  const listener = deps.listen
    ? startListening(deps.listen, wakeAll, deps.logger, () => state.running)
    : undefined

  const loops = sleepers.map(async (sleeper, lane) => {
    const light = lane >= buildLanes
    while (state.running) {
      woken[lane] = false
      // oxlint-disable-next-line no-await-in-loop -- a poll loop claims one job at a time
      const job = await claimNextJob(deps.db, lockSeconds, { light }).catch((err: unknown) => {
        deps.logger.error({ err }, 'could not claim a job')
      })
      if (!job) {
        // oxlint-disable-next-line no-await-in-loop -- idle wait between polls
        const wait = await idleWaitMs(deps, light, pollMs)
        // oxlint-disable-next-line no-await-in-loop -- idle wait between polls
        if (!woken[lane]) await sleeper.sleep(wait)
        continue
      }
      // oxlint-disable-next-line no-await-in-loop -- jobs in one lane run sequentially
      await runJob(deps, job, wakeAfter)
    }
  })

  return {
    async stop() {
      state.running = false
      for (const timer of wakeTimers) clearTimeout(timer)
      wakeTimers.clear()
      wakeAll()
      await listener?.stop()
      await Promise.all(loops)
    },
  }
}
