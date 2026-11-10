import { useEffect, useRef, type UIEvent } from 'react'

/** How long after the last scroll event an element still counts as scrolling. */
const SETTLE_MS = 900

/**
 * An `onScroll` handler that marks the element `data-scrolling` while it scrolls and for a moment
 * after, so CSS can show a scrollbar that is otherwise hidden until hover (a touch or keyboard
 * scroll has no hover).
 */
export function useScrollingFlag(): (event: UIEvent<HTMLElement>) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (event) => {
    const el = event.currentTarget
    el.dataset['scrolling'] = ''
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      delete el.dataset['scrolling']
    }, SETTLE_MS)
  }
}
