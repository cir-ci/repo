/** Runs `fn` over `items` with at most `limit` in flight. Rejects on the first failure. */
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      // oxlint-disable-next-line no-await-in-loop -- each lane works through items one at a time
      if (item !== undefined) await fn(item)
    }
  })
  await Promise.all(lanes)
}

/** A sleep that `wake()` can cut short (used to stop the poll loop promptly). */
export function interruptibleSleep(): { sleep(ms: number): Promise<void>; wake(): void } {
  let wakeUp: (() => void) | undefined
  return {
    sleep(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(done, ms)
        function done() {
          clearTimeout(timer)
          wakeUp = undefined
          resolve()
        }
        wakeUp = done
      })
    },
    wake() {
      wakeUp?.()
    },
  }
}
