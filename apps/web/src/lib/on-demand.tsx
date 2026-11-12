import { type ComponentType, createElement, lazy, Suspense, useEffect, useState } from 'react'

/**
 * A dialog that loads when it is first opened instead of with the shell: renders nothing until
 * `open` is first true, then the real component (kept mounted, so its exit animation and state
 * survive closing). Once the shell is up the browser idles into fetching it, so the first
 * open rarely waits.
 */
export function onDemand<M, P extends { open: boolean }>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
): ComponentType<P> {
  const Lazy = lazy(() => load().then((m) => ({ default: pick(m) })))
  return function OnDemand(props: P) {
    const [wanted, setWanted] = useState(props.open)
    if (props.open && !wanted) setWanted(true)
    useEffect(() => {
      const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 2000))
      idle(() => void load())
    }, [])
    return wanted ? <Suspense fallback={null}>{createElement(Lazy, props)}</Suspense> : null
  }
}
