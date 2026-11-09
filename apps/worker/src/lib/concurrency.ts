/** Runner infrastructure: a sleep that `wake()` can cut short (stops the poll loop promptly). */
export { mapLimit } from '@circi/services'

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
