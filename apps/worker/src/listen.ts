import type { ListenFn } from '@circi/db'
import { JOBS_CHANNEL } from '@circi/services'

import type { startWorker } from './runner.ts'

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 30_000

/**
 * Keeps a LISTEN on the jobs channel alive: every notification wakes the poll loops, and a
 * dropped connection is re-established with exponential backoff. Logs once per outage, then once
 * when it is back. Every connection, the first included, is followed by a wake-up: a notification
 * sent before it was listening is missed, and a lane that already went to sleep for the whole poll
 * would otherwise miss a job that came due sooner (a delayed enqueue while the worker starts).
 */
export function startListening(
  listen: ListenFn,
  wake: () => void,
  logger: startWorker.Logger,
  isRunning: () => boolean,
): { stop(): Promise<void> } {
  let unlisten: (() => Promise<void>) | undefined
  let retryTimer: NodeJS.Timeout | undefined
  let stopped = false
  let outage = false
  let delay = RECONNECT_MIN_MS

  const connect = async (): Promise<void> => {
    retryTimer = undefined
    if (stopped || !isRunning()) return
    try {
      const stop = await listen(JOBS_CHANNEL, wake, (err) => {
        unlisten = undefined
        lostConnection(err)
      })
      if (stopped) {
        await stop().catch(() => {})
        return
      }
      unlisten = stop
      delay = RECONNECT_MIN_MS
      if (outage) {
        outage = false
        logger.info('job notifications are back')
      }
      wake()
    } catch (err) {
      lostConnection(err)
    }
  }

  const lostConnection = (err: unknown): void => {
    if (stopped) return
    if (!outage) {
      outage = true
      logger.warn({ err }, 'lost the job notification connection; polling until it is back')
    }
    retryTimer = setTimeout(() => void connect(), delay)
    retryTimer.unref()
    delay = Math.min(delay * 2, RECONNECT_MAX_MS)
  }

  const first = connect()
  return {
    async stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      await first
      await unlisten?.().catch(() => {})
      unlisten = undefined
    },
  }
}
