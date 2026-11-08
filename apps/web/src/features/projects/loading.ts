import { useAnnounce } from '@circi/ui'
import { useEffect } from 'react'

/** Tells screen readers a page is still loading, but only if it takes long enough to be seen. */
export function useLoadingAnnouncement(pending: boolean, message: string, delayMs = 300) {
  const announce = useAnnounce()
  useEffect(() => {
    if (!pending) return undefined
    const timer = setTimeout(() => announce(message), delayMs)
    return () => clearTimeout(timer)
  }, [pending, message, delayMs, announce])
}
