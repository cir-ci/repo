import type { Logger } from 'pino'

/**
 * Graceful shutdown: runs `close`, exits 0, or exits 1 if it fails or takes longer than
 * `timeoutMs`. Calling it again while it runs does nothing. `exit` is `process.exit` in
 * production and a spy in tests.
 */
export function createShutdown(deps: {
  logger: Pick<Logger, 'info' | 'error'>
  close: () => Promise<void>
  exit: (code: number) => void
  timeoutMs?: number
}): (signal: string) => Promise<void> {
  let stopping = false
  return async (signal) => {
    if (stopping) return
    stopping = true
    deps.logger.info({ signal }, 'shutting down')
    const force = setTimeout(() => {
      deps.logger.error('shutdown timed out, exiting')
      deps.exit(1)
    }, deps.timeoutMs ?? 10_000)
    force.unref()
    try {
      await deps.close()
      clearTimeout(force)
      deps.exit(0)
    } catch (err) {
      clearTimeout(force)
      deps.logger.error({ err }, 'error during shutdown')
      deps.exit(1)
    }
  }
}
