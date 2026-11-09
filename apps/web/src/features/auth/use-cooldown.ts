import { useEffect, useState } from 'react'

/** A countdown in whole seconds: `start(n)` begins it, `left` is 0 when it is over. */
export function useCooldown() {
  const [left, setLeft] = useState(0)
  const running = left > 0
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(timer)
  }, [running])
  return { left, start: (seconds: number) => setLeft(seconds) }
}
