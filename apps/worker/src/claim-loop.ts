import { claimNextJob } from '@circi/services'

import { interruptibleSleep } from './lib/concurrency.ts'
import { startListening } from './listen.ts'
import { runJob } from './run-job.ts'
import type { startWorker } from './runner.ts'

/**
 * The poll lanes: each claims one job at a time (`FOR UPDATE SKIP LOCKED`, so several worker
 * processes can share a database), runs it, and sleeps when the queue is empty. A NOTIFY wakes all
 * lanes at once; the poll interval is the fallback for missed notifications.
 */
export function startLanes(deps: startWorker.Deps): { stop(): Promise<void> } {
  const pollMs = deps.pollIntervalMs ?? 1_000
  const lockSeconds = deps.lockSeconds ?? 600
  const lanes = deps.concurrency ?? 2
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
  const listener = deps.listen
    ? startListening(deps.listen, wakeAll, deps.logger, () => state.running)
    : undefined

  const loops = sleepers.map(async (sleeper, lane) => {
    while (state.running) {
      woken[lane] = false
      // oxlint-disable-next-line no-await-in-loop -- a poll loop claims one job at a time
      const job = await claimNextJob(deps.db, lockSeconds).catch((err: unknown) => {
        deps.logger.error({ err }, 'could not claim a job')
      })
      if (!job) {
        // oxlint-disable-next-line no-await-in-loop -- idle wait between polls
        if (!woken[lane]) await sleeper.sleep(pollMs)
        continue
      }
      // oxlint-disable-next-line no-await-in-loop -- jobs in one lane run sequentially
      await runJob(deps, job)
    }
  })

  return {
    async stop() {
      state.running = false
      wakeAll()
      await listener?.stop()
      await Promise.all(loops)
    },
  }
}
