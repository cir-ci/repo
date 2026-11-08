import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import styles from './Announcer.module.css'

const AnnouncerContext = createContext<(message: string) => void>(() => {})

/**
 * Provides `useAnnounce()` and renders the single polite `role="status"` live region (always in
 * the DOM, so screen readers register it before the first message). Results show where the
 * action happened; the announcer is how a screen reader hears them (docs/design-gaps.md §3).
 */
export function AnnouncerProvider({ children }: AnnouncerProvider.Props) {
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
      <div role="status" aria-live="polite" className={styles['region']}>
        {message}
      </div>
    </AnnouncerContext.Provider>
  )
}

export namespace AnnouncerProvider {
  export interface Props {
    children: ReactNode
  }
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnouncerContext)
}
