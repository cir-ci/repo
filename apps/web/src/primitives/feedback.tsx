import { Box, keyframes, Skeleton } from '@mui/material'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { visuallyHidden } from '../theme.ts'

/**
 * Loading feedback per Primer (https://primer.style/product/ui-patterns/loading):
 * - Under a second, show nothing: a flash of placeholders feels slower than none.
 * - Placeholders take the shape of the content they stand in for, so nothing jumps on load.
 * - One `role="status"` region, always in the DOM, announces loading and results once.
 */

const appear = keyframes`from { opacity: 0 } to { opacity: 1 }`

/** Reserves the content's space at once, but only becomes visible after `delayMs`. */
export function Delayed({ children, delayMs = 1000 }: { children: ReactNode; delayMs?: number }) {
  return (
    <Box
      sx={{ opacity: 0, animation: `${appear} 150ms ease-out ${delayMs}ms forwards` }}
      aria-hidden
    >
      {children}
    </Box>
  )
}

/** Placeholder rows shaped like a list of title + metadata lines. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Delayed>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {Array.from({ length: rows }, (_, i) => (
          <Box key={i} sx={{ px: 2, py: 1.5, borderTop: i === 0 ? 0 : 1, borderColor: 'divider' }}>
            <Skeleton width="30%" height={20} />
            <Skeleton width="55%" height={16} />
          </Box>
        ))}
      </Box>
    </Delayed>
  )
}

const AnnouncerContext = createContext<(message: string) => void>(() => {})

/** Provides `useAnnounce()` and renders the single polite live region. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const announce = useCallback((next: string) => {
    // Clear first so repeating the same message is announced again.
    setMessage('')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(next), 50)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {message}
      </Box>
    </AnnouncerContext.Provider>
  )
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnouncerContext)
}
